/* ============================================================
   TripMemo 地图视图（js/map.js）

   职责：加载高德地图、把地点画成"大小随停留时长变化"的点、
        按类型筛选、点地图空白处新增地点。

   Day 7 · 步骤 2b
   注意：本步骤的"新增录入"用的是临时输入框（prompt），
        步骤 2c 会换成正式的地点详情弹窗（三种形态）。
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;
  var Store = global.TripMemoStore;

  /* 地图主体 */
  var map = null;

  /* 当前正在显示的类型筛选（空字符串 = 全部） */
  var activeType = '';

  /* 被"高亮"的城市 —— 点地点列表里的城市名时设置（PRD 验收标准 10） */
  var highlightedCity = '';

  /* 已经画在地图上的点标记，重画前要清掉 */
  var markers = [];

  /* 已经画在地图上的连线 */
  var lines = [];

  /* 主城市锚点（同一时刻只有一个主城市） */
  var anchorMarker = null;

  /* 地图视图的 DOM */
  var elCanvas = null;
  var elEmpty = null;
  var elFilterBar = null;
  var elTooltip = null;

  /* 防止"点击标记"同时触发"点击地图空白处" */
  var lastMarkerClickAt = 0;

  /* 中国大致中心点，作为没有数据时的默认视野 */
  var CHINA_CENTER = [104.2, 35.9];
  var CHINA_ZOOM = 5;

  /* ------------------------------------------------------------
     一、加载高德 SDK
     ------------------------------------------------------------ */

  /** 读取本地配置（config.js 里的 window.TRIPMEMO_CONFIG） */
  function readConfig() {
    return global.TRIPMEMO_CONFIG || null;
  }

  /**
   * 动态加载高德 JS API
   * 必须先设 _AMapSecurityConfig（安全密钥），再加载 SDK —— 顺序反了会失败
   * @returns {Promise}
   */
  function loadAmapSDK() {
    return new Promise(function (resolve, reject) {
      if (global.AMap) {
        resolve(global.AMap);
        return;
      }

      var cfg = readConfig();
      if (!cfg || !cfg.amapKey || cfg.amapKey.indexOf('在这里填入') === 0) {
        reject(new Error('没有找到高德 Key。请把 config.example.js 复制成 config.js，并填入 Key 与安全密钥。'));
        return;
      }

      /* 安全密钥必须在 SDK 之前设好 */
      global._AMapSecurityConfig = {
        securityJsCode: cfg.amapSecurityCode || ''
      };

      var script = document.createElement('script');
      /* plugin 参数：顺带把两个能力加载进来
         AMap.PlaceSearch → 搜索选点（每条结果自带坐标与城市名）
         AMap.Geocoder    → 由城市名反查坐标（"设定主城市"要用） */
      script.src = 'https://webapi.amap.com/maps?v=2.0'
        + '&key=' + encodeURIComponent(cfg.amapKey)
        + '&plugin=AMap.PlaceSearch,AMap.Geocoder';
      script.onload = function () {
        if (global.AMap) {
          resolve(global.AMap);
        } else {
          reject(new Error('高德 SDK 已加载，但 AMap 对象不存在。多半是 Key 或安全密钥不正确。'));
        }
      };
      script.onerror = function () {
        reject(new Error('高德 SDK 加载失败。请检查网络，或 Key 是否属于「Web端（JS API）」类型。'));
      };
      document.head.appendChild(script);
    });
  }

  /* ------------------------------------------------------------
     二、初始化地图
     ------------------------------------------------------------ */
  function initMap() {
    map = new AMap.Map(elCanvas, {
      zoom: CHINA_ZOOM,
      center: CHINA_CENTER,
      viewMode: '2D'
    });

    /* 点击地图空白处 → 新增地点（PRD 4.1 #1） */
    map.on('click', function (e) {
      /* 刚点过标记就忽略这次（标记点击不该触发新增） */
      if (Date.now() - lastMarkerClickAt < 250) {
        return;
      }
      var lng = e.lnglat.getLng();
      var lat = e.lnglat.getLat();
      /* 留一条日志：点击没反应时，用它区分"事件根本没进来"和"进来了但录入被取消" */
      console.log('[TripMemo] 地图被点击：', lng, lat);
      handleMapClick(lng, lat);
    });
  }

  /** 地图被切到前台时要重算尺寸，否则会显示不全 */
  function resizeMap() {
    if (map && typeof map.resize === 'function') {
      setTimeout(function () { map.resize(); }, 0);
    }
  }

  /* ------------------------------------------------------------
     二之二、搜索选点（PRD 4.1 #1 的第二种方式 / 验收标准 2）

     为什么必须有它：在缩小的比例尺下用鼠标点，一个像素覆盖几十公里，
                   点必然不准。知道地名时，搜索才是精确的做法。
     ------------------------------------------------------------ */
  function initSearch() {
    var input = document.getElementById('map-search-input');
    var dropdown = document.getElementById('search-dropdown');
    if (!input || !dropdown) {
      return;
    }
    if (!AMap.plugin) {
      console.error('[TripMemo] AMap.plugin 不可用，无法加载搜索能力');
      return;
    }

    /* 用 PlaceSearch（POI 搜索），不用 AutoComplete。
       原因：PlaceSearch 的每条结果【同时带坐标和城市名】，
            一次请求就够；而 AutoComplete 的候选不带坐标，
            还得再调一次"逆地理编码"才能拿到城市名 —— 多一个出错点。 */
    AMap.plugin(['AMap.PlaceSearch', 'AMap.Geocoder'], function () {

      if (!AMap.PlaceSearch) {
        console.error('[TripMemo] PlaceSearch 插件加载失败，搜索选点不可用');
        return;
      }

      var placeSearch = new AMap.PlaceSearch({ pageSize: 10, pageIndex: 1 });
      var geocoder = AMap.Geocoder ? new AMap.Geocoder() : null;  /* 设主城市时要用 */

      var debounceTimer = null;
      var currentPois = [];

      /* 收起下拉 */
      function closeDropdown() {
        dropdown.setAttribute('hidden', '');
        dropdown.innerHTML = '';
        currentPois = [];
      }

      /* 选中一条搜索结果 */
      function choosePoi(poi) {
        if (!poi || !poi.location) {
          console.warn('[TripMemo] 这条结果没有坐标，已忽略：', poi);
          return;
        }
        var lng = poi.location.getLng();
        var lat = poi.location.getLat();
        var name = poi.name || '';
        var city = poi.cityname || '';

        console.log('[TripMemo] 搜索选中：' + name
          + ' @ ' + lng + ',' + lat
          + '（城市：' + (city || '未提供') + '）');

        /* 地图视野移过去 */
        map.setZoomAndCenter(12, [lng, lat]);

        /* 立刻打开新增弹窗 —— 坐标和城市名都已经有了，不再需要任何异步请求 */
        if (global.TripMemoDetail) {
          global.TripMemoDetail.openNew(lng, lat, { name: name, city: city });
        }
        input.value = '';
        closeDropdown();
      }

      /* 画下拉列表 */
      function renderDropdown(pois) {
        dropdown.innerHTML = '';
        if (!pois.length) {
          closeDropdown();
          return;
        }
        currentPois = pois;

        pois.forEach(function (poi) {
          var li = document.createElement('li');
          li.className = 'search-item';

          var nameEl = document.createElement('span');
          nameEl.className = 'search-item-name';
          nameEl.textContent = poi.name || '';

          var districtEl = document.createElement('span');
          districtEl.className = 'search-item-district';
          districtEl.textContent = [poi.cityname, poi.adname]
            .filter(Boolean).join(' · ');

          li.appendChild(nameEl);
          li.appendChild(districtEl);
          li.addEventListener('click', function () { choosePoi(poi); });
          dropdown.appendChild(li);
        });

        dropdown.removeAttribute('hidden');
      }

      /* 输入 → 防抖 300 毫秒 → 搜索（防抖是为了省额度、也少发无用请求） */
      input.addEventListener('input', function () {
        var keyword = input.value.trim();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        if (!keyword) {
          closeDropdown();
          return;
        }
        debounceTimer = setTimeout(function () {
          placeSearch.search(keyword, function (status, result) {
            if (status !== 'complete' || !result || !result.poiList) {
              console.warn('[TripMemo] 搜索没结果或失败（status=' + status + '）');
              closeDropdown();
              return;
            }
            renderDropdown(result.poiList.pois || []);
          });
        }, 300);
      });

      /* 回车直接选第一条；Esc 收起 */
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && currentPois.length) {
          e.preventDefault();
          choosePoi(currentPois[0]);
        } else if (e.key === 'Escape') {
          closeDropdown();
        }
      });

      /* 点页面别处收起下拉 */
      document.addEventListener('click', function (e) {
        if (e.target !== input && !dropdown.contains(e.target)) {
          closeDropdown();
        }
      });

      console.log('[TripMemo] 搜索选点已就绪（PlaceSearch）');
    });
  }

  /* ------------------------------------------------------------
     三、筛选栏
     ------------------------------------------------------------ */
  function renderFilterBar() {
    if (!elFilterBar) {
      return;
    }
    elFilterBar.innerHTML = '';

    /* 「全部」+ 四个类型 */
    var options = [{ key: '', label: '全部' }].concat(Model.PLACE_TYPES);

    options.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (opt.key === activeType ? ' is-active' : '');
      btn.textContent = opt.label;
      btn.addEventListener('click', function () {
        activeType = opt.key;
        renderFilterBar();
        refresh();   /* 点和线一起重画（线的粗细跟着筛选后的城市算） */
      });
      elFilterBar.appendChild(btn);
    });
  }

  /* ------------------------------------------------------------
     四、把地点画到地图上
     ------------------------------------------------------------ */

  /** 清掉上次画的点 */
  function clearMarkers() {
    if (map && markers.length) {
      map.remove(markers);
    }
    markers = [];
    hideTooltip();   /* 重画前先收起提示，避免残留 */
  }

  /** 显示/隐藏空状态（PRD 验收标准 27） */
  function updateEmptyState() {
    var total = Store.listPlaces().length;
    if (!elEmpty) {
      return;
    }
    /* 一个地点都没有时，才显示空状态 */
    if (total === 0) {
      elEmpty.removeAttribute('hidden');
    } else {
      elEmpty.setAttribute('hidden', '');
    }
  }

  /** 重画所有点 */
  function renderMarkers() {
    if (!map) {
      return;
    }
    clearMarkers();

    var places = Store.filterByType(activeType);

    places.forEach(function (place) {
      if (isNaN(place.lng) || isNaN(place.lat)) {
        return;
      }
      var diameter = Model.dotDiameter(place);
      var color = Model.TYPE_COLORS[place.type] || '#185FA5';

      /* 被选中的城市：描边加粗、颜色变深，在一堆点里一眼能认出来
         （比较用规范化城市名，免得"武汉市"和"武汉"对不上） */
      var highlighted = !!highlightedCity && Model.isSameCity(place.city, highlightedCity);

      var marker = new AMap.CircleMarker({
        center: [place.lng, place.lat],
        radius: diameter / 2,           /* 高德这里要的是半径 */
        fillColor: color,
        fillOpacity: 0.9,
        strokeColor: highlighted ? '#2c2c2a' : '#ffffff',
        strokeWeight: highlighted ? 3.5 : 1.5,
        zIndex: highlighted ? 9999 : diameter,  /* 高亮的点压在最上层 */
        extData: { placeId: place.id }
      });

      /* 悬停：显示地点名与停留时长（PRD 验收标准 5 / 31） */
      marker.on('mouseover', function () {
        showTooltip(place);
      });

      /* 鼠标移开：收起提示 */
      marker.on('mouseout', function () {
        hideTooltip();
      });

      /* 点击点：2c 步骤接入详情弹窗，这里先打印一下 */
      marker.on('click', function () {
        lastMarkerClickAt = Date.now();
        console.log('[TripMemo] 点到了地点：', place.name, place.id);
        handleMarkerClick(place);
      });

      markers.push(marker);
    });

    if (markers.length) {
      map.add(markers);
    }
    updateEmptyState();
  }

  /* ------------------------------------------------------------
     四之二、主城市锚点与连线（PRD 4.1 #8 / 验收标准 15–23）

     规则回顾：
       · 主城市只有一个，由用户自选，作为"人生锚点"
       · 从锚点向每个「非主城市」画一条线 —— 按城市聚合，不是每个点一条
       · 主城市内的地点不连线
       · 线宽 ∝ 该城市的累计停留时长，并有上下限
       · 主城市还没有任何地点时：只显示【灰色锚点】，不画任何线
     ------------------------------------------------------------ */

  /** 清掉上次画的锚点与连线 */
  function clearOverlay() {
    if (!map) {
      return;
    }
    if (lines.length) {
      map.remove(lines);
      lines = [];
    }
    if (anchorMarker) {
      map.remove(anchorMarker);
      anchorMarker = null;
    }
  }

  /** 画锚点与连线 */
  function renderOverlay() {
    if (!map) {
      return;
    }
    clearOverlay();

    /* 没设主城市 → 什么都不画，但点照常显示（验收标准 21） */
    var mainCity = Store.getMainCity();
    if (!mainCity) {
      return;
    }

    /* 该主城市下有没有地点 —— 决定锚点是正常色还是灰色（验收标准 22 / 23）
       注意：这里用「全部地点」判断，不随类型筛选变化，
            因为锚点代表的是"这个城市的地位"，跟看哪一类地点无关 */
    var hasPlace = Store.listPlaces().some(function (place) {
      return Model.isSameCity(place.city, mainCity.city);
    });

    /* 1、画锚点 */
    anchorMarker = new AMap.Marker({
      position: [mainCity.lng, mainCity.lat],
      content: '<div class="map-anchor'
        + (hasPlace ? '' : ' map-anchor--empty')
        + '">★</div>',
      offset: new AMap.Pixel(-13, -13),
      zIndex: 500,
      title: mainCity.city + (hasPlace ? '（主城市）' : '（主城市 · 该城市还没有地点）')
    });
    map.add(anchorMarker);

    /* 2、主城市还没有地点时不画线（验收标准 22） */
    if (!hasPlace) {
      console.log('[TripMemo] 主城市「' + mainCity.city + '」还没有地点，只显示灰色锚点');
      return;
    }

    /* 3、按城市聚合后逐个画线（跟地图上看得见的点保持一致）
       ⚠️ 必须剔除「想去」—— 那是"还没去过"的地方，
          不该出现在"从锚点出发去过哪"的连线上 */
    var visited = Store.filterByType(activeType).filter(function (place) {
      return place.type !== Model.WISHLIST_KEY;
    });
    var stats = Model.cityStats(visited);

    stats.forEach(function (item) {
      /* 主城市自己的点不连线（验收标准 17） */
      if (Model.isSameCity(item.city, mainCity.city)) {
        return;
      }
      lines.push(new AMap.Polyline({
        path: [
          [mainCity.lng, mainCity.lat],
          [item.lng, item.lat]
        ],
        strokeColor: '#185FA5',
        strokeWeight: Model.lineWidthByMonths(item.totalMonths),  /* 线宽 ∝ 累计停留时长（验收标准 18） */
        strokeOpacity: 0.7,
        lineJoin: 'round',
        zIndex: 100
      }));
    });

    if (lines.length) {
      map.add(lines);
    }
    console.log('[TripMemo] 已画 ' + lines.length + ' 条连线，从「' + mainCity.city + '」出发');
  }

  /** 重画地图上的全部内容（点 + 锚点 + 线） */
  function refresh() {
    renderMarkers();
    renderOverlay();
  }

  /* ------------------------------------------------------------
     四之三、主城市设置入口
     ------------------------------------------------------------ */

  /** 用高德地理编码把城市名换成中心坐标，再存起来 */
  function setMainCityByName(name) {
    if (!AMap.Geocoder) {
      window.alert('地理编码能力不可用，暂时无法设定主城市。');
      return;
    }
    var geocoder = new AMap.Geocoder();
    geocoder.getLocation(name, function (status, result) {
      if (status !== 'complete' || !result || !result.geocodes || !result.geocodes.length) {
        window.alert('没找到「' + name + '」。换个写法试试（填"武汉"就够，不用填到街道）。');
        return;
      }
      var geo = result.geocodes[0];
      /* 存高德返回的规范城市名；拿不到就用用户输入的 */
      var cityName = geo.city || name;
      Store.setMainCity({
        city: cityName,
        lng: geo.location.getLng(),
        lat: geo.location.getLat()
      });
      console.log('[TripMemo] 主城市已设为：' + cityName);
    });
  }

  /** 绑定主城市输入框与两个按钮 */
  function initMainCityUI() {
    var input = document.getElementById('main-city-input');
    var setBtn = document.getElementById('main-city-set');
    var clearBtn = document.getElementById('main-city-clear');
    if (!input || !setBtn || !clearBtn) {
      return;
    }

    /* 已经设过的话，把城市名显示出来 */
    var current = Store.getMainCity();
    if (current) {
      input.value = current.city;
    }

    setBtn.addEventListener('click', function () {
      var name = (input.value || '').trim();
      if (!name) {
        window.alert('请先输入城市名，例如：武汉');
        return;
      }
      setMainCityByName(name);
    });

    clearBtn.addEventListener('click', function () {
      Store.setMainCity(null);
      input.value = '';
      console.log('[TripMemo] 已清除主城市');
    });
  }
  /* ------------------------------------------------------------
     四之四、悬停提示（PRD 验收标准 5 / 31）

     自己做一个跟着点显示的小标签。
     不能用 marker.setTitle —— 那是浏览器原生 title，有延迟，
     而且点画在 canvas 里，原生 title 并不可靠。
     ------------------------------------------------------------ */

  /** 显示提示：内容 + 位置 */
  function showTooltip(place) {
    if (!elTooltip || !map) {
      return;
    }

    /* 「想去」的地点显示「下一站」，不显示停留时长（PRD 验收标准 31） */
    var detail = place.type === Model.WISHLIST_KEY
      ? '下一站'
      : (Model.typeLabel(place.type) + ' · ' + Model.stayLabel(place));

    elTooltip.textContent = place.name + ' ｜ ' + detail;

    /* 把经纬度换算成"相对地图容器"的像素坐标 */
    var pos = map.lngLatToContainer([place.lng, place.lat]);
    elTooltip.style.left = pos.x + 'px';
    elTooltip.style.top = pos.y + 'px';
    elTooltip.removeAttribute('hidden');
  }

  /** 隐藏提示 */
  function hideTooltip() {
    if (elTooltip) {
      elTooltip.setAttribute('hidden', '');
    }
  }

  /* ------------------------------------------------------------
     五、新增与查看（都交给详情弹窗处理）
     ------------------------------------------------------------ */

  /** 点击一个点 → 打开「查看态」弹窗（PRD 5.4 / 验收标准 33） */
  function handleMarkerClick(place) {
    if (global.TripMemoDetail) {
      global.TripMemoDetail.openView(place.id);
    }
  }

  /**
   * 点击地图空白处 → 打开「新增态」弹窗，并把点击处的坐标带过去
   * @param {number} lng
   * @param {number} lat
   */
  function handleMapClick(lng, lat) {
    if (global.TripMemoDetail) {
      global.TripMemoDetail.openNew(lng, lat);
    }
  }

  /* ------------------------------------------------------------
     六、对外初始化
     ------------------------------------------------------------ */
  function init() {
    elCanvas = document.getElementById('map-canvas');
    elEmpty = document.getElementById('map-empty');
    elFilterBar = document.getElementById('map-filter');
    elTooltip = document.getElementById('map-tooltip');

    if (!elCanvas) {
      return;
    }

    renderFilterBar();

    loadAmapSDK()
      .then(function () {
        initMap();
        initSearch();
        initMainCityUI();
        refresh();
        resizeMap();
        console.log('[TripMemo] 地图已就绪');
      })
      .catch(function (err) {
        /* 地图起不来时，把原因直接显示在页面上，别让它静默失败 */
        console.error('[TripMemo] 地图初始化失败：', err);
        if (elEmpty) {
          elEmpty.removeAttribute('hidden');
          elEmpty.innerHTML = '<p>地图未能加载：' + err.message + '</p>';
        }
      });

    /* 视图切换时重算地图尺寸 */
    document.addEventListener('view:change', function (e) {
      if (e.detail && e.detail.view === 'map') {
        resizeMap();
      }
    });

    /* 数据变了就重画（点 + 锚点 + 线） */
    document.addEventListener('data:change', function () {
      refresh();
    });

    /* 主城市设置变了也要重画（验收标准 20：换主城市后线自动重算） */
    document.addEventListener('settings:change', function () {
      refresh();
    });
  }

  /**
   * 高亮某个城市的全部地点（供地点列表视图调用）
   * 传空字符串表示取消高亮
   * @param {string} city
   */
  function highlightCity(city) {
    highlightedCity = city || '';
    renderMarkers();
    console.log('[TripMemo] 地图高亮城市：' + (highlightedCity || '（已取消）'));
  }

  global.TripMemoMap = {
    init: init,
    renderMarkers: renderMarkers,
    highlightCity: highlightCity
  };

}(window));

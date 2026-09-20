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
  var elLoading = null;      /* 加载中状态（Day 8） */
  var elError = null;        /* 错误状态（Day 8） */
  var elErrorMsg = null;

  /* SDK 加载超时时间（毫秒）
     ⚠️ 为什么必须有超时：只有"加载中"没有超时，就是**无限转圈** ——
        网络断了或接口卡住时，用户会一直等下去，永远等不到结果，
        也不会知道该干什么。这是"加载中"这个状态最常见的错误做法。
        超时后转成明确的错误提示，用户才知道"它不会好了，要动手"。 */
  var SDK_TIMEOUT_MS = 15000;

  /* 防止"点击标记"同时触发"点击地图空白处" */
  var lastMarkerClickAt = 0;

  /* 地图是不是加载失败了（Day 8）
     为什么要这个标志：空状态是根据"有没有数据"自动显示/隐藏的，
     地图失败后再刷新数据时，它会把"还没有记录"重新显示出来，
     和错误面板叠在一起、互相打架。用这个标志把空状态压住。 */
  var mapFailed = false;

  /* 中国大致中心点，作为没有数据时的默认视野 */
  var CHINA_CENTER = [104.2, 35.9];
  var CHINA_ZOOM = 5;

  /* 官方内置的底图样式（兜底 + 项目默认）。
     ⭐ 完整清单 = 官方 11 种（Day 8 查官方文档核实）：
       标准      amap://styles/normal
       幻影黑    amap://styles/dark
       月光银    amap://styles/light
       远山黛    amap://styles/whitesmoke
       草色青    amap://styles/fresh        ← 当前默认
       雅士灰    amap://styles/grey
       涂鸦      amap://styles/graffiti
       马卡龙    amap://styles/macaron
       靛青蓝    amap://styles/blue
       极夜蓝    amap://styles/darkblue
       酱籽      amap://styles/wine

     ⭐⭐ 这里和 config.js 的关系（很容易搞混，务必看清）：
       · 本文件里的 DEFAULT_MAP_STYLE = **项目默认样式，会进仓库**
       · config.js 里的 mapStyle       = **个人本地覆盖，被 gitignore 挡着，不进仓库**
       · 代码取值顺序：`config.js 的 mapStyle || 这里的 DEFAULT_MAP_STYLE`
         也就是 **config 优先，但 config 只在你自己电脑上有效**

     ⚠️ 2026-09-19 的教训：他在 config.js 里试出 fresh 之后，
        以为"样式定下来了"—— 但仓库里仍是 whitesmoke，
        别人克隆 / 他换电脑都会变回远山黛。
        **想真正定格样式，必须改这一行。**

     当前选 fresh（草色青）：2026-09-19 他逐个试过后挑的
     （试过 wine 深酒红，觉得太丑已排除；dark / darkblue 深色方案也早已放弃）。 */
  var DEFAULT_MAP_STYLE = 'amap://styles/fresh';

  /* ------------------------------------------------------------
     关于"能不能只改底图里的某一种元素"（如边界线颜色）
     ------------------------------------------------------------
     ⚠️ 结论：**不能**（Day 8 实测确认）
     · 高德官方只提供两种改底图配色的方式：
       ① 整体换预设样式（mapStyle: 'amap://styles/xxx'）
       ② 去控制台创建自定义样式，拿到 ID 后用
       【没有】提供"在代码里微调官方预设里某个元素"的 API
     · 曾试过第三方博客的写法：
         styles: [{ featureType: 'boundary', elementType: 'geometry',
                    stylers: { color: '#8A6A45' } }]
       以及把 featureType 换成中文 '行政边界' 的版本 ——
       **两种写法实测均无效**（控制台无报错，但边界线颜色毫无变化），
       已整体删除，不再保留死代码。
     · 所以想改底图配色只有两条路：换整体预设，或走控制台自定义样式。 */


  /* ------------------------------------------------------------
     一之二、三种页面状态（Day 8 新增）

     加载中 / 错误 / 空 —— 三者长得像，但意思完全不同，不能混用：
       · 加载中 = 还在等，别动，马上就好
       · 错误   = 环境出问题了，用户解决不了，要告诉他原因和下一步
       · 空     = 环境没问题，只是用户还没记东西，用户自己能解决

     ⚠️ 改版前的情况：错误提示**复用了空状态元素**（把 map-empty 的
        文案改成错误消息），等于把错误伪装成"没数据"。已拆开。
     ------------------------------------------------------------ */

  /** 显示「加载中」 */
  function showLoading() {
    mapFailed = false;
    if (elLoading) {
      elLoading.removeAttribute('hidden');
    }
    if (elError) {
      elError.setAttribute('hidden', '');
    }
    if (elEmpty) {
      elEmpty.setAttribute('hidden', '');
    }
  }

  /** 隐藏「加载中」 */
  function hideLoading() {
    if (elLoading) {
      elLoading.setAttribute('hidden', '');
    }
  }

  /**
   * 显示「错误」
   * @param {string} message 人话描述的原因
   */
  function showError(message) {
    mapFailed = true;
    hideLoading();
    if (elErrorMsg) {
      elErrorMsg.textContent = message || '原因不明。';
    }
    if (elError) {
      elError.removeAttribute('hidden');
    }
    /* 地图都起不来，"还没有记录"的提示就是噪音，收起来 */
    if (elEmpty) {
      elEmpty.setAttribute('hidden', '');
    }
  }

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
   * @param {number} timeoutMs 超时时间；超时视为失败（避免无限转圈）
   * @returns {Promise}
   */
  function loadAmapSDK(timeoutMs) {
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

      /* 超时保险：到点还没好就当失败，别让用户干等 */
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error('等了 ' + Math.round(timeoutMs / 1000) + ' 秒还没加载好，'
          + '多半是网络太慢或被拦住了。'));
      }, timeoutMs);

      function finish(fn, arg) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn(arg);
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
          finish(resolve, global.AMap);
        } else {
          finish(reject, new Error('高德 SDK 已加载，但 AMap 对象不存在。多半是 Key 或安全密钥不正确。'));
        }
      };
      script.onerror = function () {
        finish(reject, new Error('高德 SDK 加载失败。请检查网络，或 Key 是否属于「Web端（JS API）」类型。'));
      };
      document.head.appendChild(script);
    });
  }

  /* ------------------------------------------------------------
     二、初始化地图
     ------------------------------------------------------------ */
  function initMap() {
    /* 底图样式：优先用 config.js 里配置的（高德控制台自定义样式），
       没配就退回官方内置样式（见 DEFAULT_MAP_STYLE）。
       改样式不用动代码 —— 只改 config.js 的 mapStyle 字段即可 */
    var cfg = readConfig() || {};
    var style = cfg.mapStyle || DEFAULT_MAP_STYLE;

    map = new AMap.Map(elCanvas, {
      zoom: CHINA_ZOOM,
      center: CHINA_CENTER,
      viewMode: '2D',
      mapStyle: style,
      /* ⚠️ Day 8 美化改版：只保留「背景 / 道路 / 建筑」三类要素，
         不显示 point（兴趣点，即"武汉市第六中学"这类密密麻麻的地名）。
         原因：这些 POI 文字非常"吵"，会跟我们的点抢注意力，
               而本项目的视觉主角是"点的大小"，别的都得让路。
         官方支持的可选值（见高德 JSAPI 2.0 文档 setFeatures）：
           bg（地图背景）/ point（兴趣点）/ road（道路）
           / building（建筑物） */
      features: ['bg', 'road', 'building']
    });

    console.log('[TripMemo] 地图底图样式：', style, '｜只保留背景/道路/建筑，已隐藏兴趣点');

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

      /* 键盘当前高亮的是第几条（Day 9）。
         ⚠️ 为什么需要它：下拉的 <li> **不可聚焦**，
            键盘焦点始终停在输入框上，"当前选到第几条"没法靠 :focus 表达 ——
            只能自己记一个下标，再把它同步到 DOM 上（对应 aria-activedescendant）。
            -1 表示"还没选"。 */
      var activeIndex = -1;

      /* 把"当前选到第几条"同步到 DOM（Day 9）——
         一次做三件事：类名（看得见的高亮）、
         aria-activedescendant（告诉读屏"就是这条"）、aria-expanded（下拉开着没）。 */
      function syncActive() {
        var items = dropdown.querySelectorAll('.search-item');
        for (var i = 0; i < items.length; i++) {
          var on = (i === activeIndex);
          items[i].classList.toggle('is-active', on);
          items[i].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        if (activeIndex >= 0 && items[activeIndex]) {
          input.setAttribute('aria-activedescendant', items[activeIndex].id);
          /* 高亮项可能在滚动区外 → 滚进可视范围。
             用 block:'nearest'，避免整页跟着跳。 */
          if (items[activeIndex].scrollIntoView) {
            items[activeIndex].scrollIntoView({ block: 'nearest' });
          }
        } else {
          input.removeAttribute('aria-activedescendant');
        }
        /* ⚠️ aria-expanded 必须在这一起同步 —— 它和"下拉开没开"本来就是同一件事。
           我第一版只在 closeDropdown 里写了 'false'，结果**开着时也一直报 'false'**，
           读屏会被反过来误导。⭐ 一个状态分两处各写一半，必然漏一边。 */
        input.setAttribute('aria-expanded',
          dropdown.hasAttribute('hidden') ? 'false' : 'true');
      }

      /* 收起下拉 */
      function closeDropdown() {
        dropdown.setAttribute('hidden', '');
        dropdown.innerHTML = '';
        currentPois = [];
        activeIndex = -1;
        /* aria 统一交给 syncActive 收尾，不在两处各写一半（见上面的教训） */
        syncActive();
      }

      /* 方向键移动高亮项。step = +1 / -1。
         ⚠️ 到两端就停住、**不循环** —— 不循环更容易判断"到底了"，
            也和浏览器原生下拉的行为一致。 */
      function moveActive(step) {
        if (!currentPois.length) {
          return;
        }
        var next = activeIndex + step;
        if (next < 0) {
          next = 0;
        }
        if (next > currentPois.length - 1) {
          next = currentPois.length - 1;
        }
        activeIndex = next;
        syncActive();
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

        pois.forEach(function (poi, i) {
          var li = document.createElement('li');
          li.className = 'search-item';

          /* 无障碍（Day 9）：listbox / option 这一对角色，
             id 是被输入框 aria-activedescendant 引用的"地址"。
             ⚠️ 不加 role 的话读屏只会念出一串孤立的文字，用户不知道这是可选列表。 */
          li.setAttribute('role', 'option');
          li.id = 'search-option-' + i;
          li.setAttribute('aria-selected', 'false');

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
        /* 新一批结果 → 高亮回到第一条（和浏览器原生下拉一致：
           搜完直接按回车就是选第一条，不用先按方向键）。 */
        activeIndex = 0;
        syncActive();
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

      /* 键盘操作下拉（Day 9 修复）
         ⚠️ 修复前这里**只有 Enter 和 Escape** ——
            键盘用户**永远只能选第一条**，第 2 条以后够不着。
            而搜索选点是"知道地名时唯一的精确入口"，等于半个功能不可用。

         ⭐ Day 9 补：左右方向键也参与导航（由 shy 试用后提出）。
            四个方向对称：下/右 = 下一条，上/左 = 上一条。

         ⚠️ 这里有一个**要付的代价**，说清楚：
            左右键在原生的文本输入框里是"移动光标"，现在被借去走列表了。
            所以**下拉开着的时候，光标没法用左右键移动** —— 想移动光标，
            按 Esc 先收起下拉（文字会保留），或者直接用鼠标点。
            对这个场景的取舍理由：搜索关键词只有几个字，需要挪光标的场合很少；
            而"四个方向键都能走列表"是很多人下意识的用法。
            （`preventDefault` 只在**有结果可走**时才拦 —— 没结果时左右键
              完全保持原生行为，不白抢按键。） */
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          if (currentPois.length) {
            e.preventDefault();   /* 不拦的话光标会跳到文字末尾 */
            moveActive(1);
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          if (currentPois.length) {
            e.preventDefault();
            moveActive(-1);
          }
        } else if (e.key === 'Enter') {
          if (currentPois.length) {
            e.preventDefault();
            /* 选"当前高亮的那一条"，不再是写死的第 0 条 */
            choosePoi(currentPois[activeIndex >= 0 ? activeIndex : 0]);
          }
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
    /* 地图加载失败时不显示空状态 —— 否则"还没有记录"会和错误面板
       叠在一起，让用户以为是没数据而不是出了问题（Day 8） */
    if (mapFailed) {
      elEmpty.setAttribute('hidden', '');
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
      var color = Model.TYPE_COLORS[place.type] || Model.TYPE_COLORS.long;

      /* 被选中的城市：描边加粗、颜色变亮，在一堆点里一眼能认出来
         （比较用规范化城市名，免得"武汉市"和"武汉"对不上） */
      var highlighted = !!highlightedCity && Model.isSameCity(place.city, highlightedCity);

      /* ⚠️ Day 8 美化改版（最终）：描边用白色。
         现在是【奶油浅色地图底】，点的填充色是深色系（藏蓝/松绿/橙/暖灰），
         深色块在浅底上本来就清楚，加一圈白边是为了：
         ① 让相邻的点在重叠时能分开边界
         ② 让点在米色底图上显得"干净、像贴上去的"
         高亮态（点城市列表里的城市名）用更粗的暖棕边把它框出来。 */
      var marker = new AMap.CircleMarker({
        center: [place.lng, place.lat],
        radius: diameter / 2,           /* 高德这里要的是半径 */
        fillColor: color,
        fillOpacity: 0.92,
        strokeColor: highlighted ? '#3A332B' : '#FFFFFF',
        strokeWeight: highlighted ? 3 : 1.5,
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

  /* ------------------------------------------------------------
     四之三、弧线（Day 8 加练 · 步骤③）

     为什么把直线改成弧线：**直线是"平"的，弧线暗示了高度。**
     就像航线图、地铁线路图 —— 线一旦拱起来，大脑会自动读出
     "这条线是飘在上面的"，整张图立刻有了立体感。
     （这是从 Tooolive/Map-Of-My-Journey 借来的手法，
       它是 ECharts 的 `lineStyle.curveness: .12`；
       高德这边对应的做法是 `AMap.BezierCurve` 贝塞尔曲线。）

     下面三个常量是**唯一需要调的旋钮**，改完刷新页面就生效。
     ------------------------------------------------------------ */

  /* 拱起多少：相对「两点直线距离」的比例
     ⚠️ 这个数最容易调不好 ——
        太小（< .08）→ 看着还是直线，白改
        太大（> .3 ）→ 7 条线互相交叉，糊成一团
        .18 是初始值。觉得不够弯就调大，觉得乱就调小。 */
  var ARC_BULGE = 0.18;

  /* 往哪一侧拱：+1 或 -1。换个符号，所有弧线一起朝另一边弯。 */
  var ARC_SIDE = 1;

  /* ---------- 线的颜色与存在感 ----------
     ⚠️ 2026-09-19：底图从 whitesmoke（极浅米白）换成 fresh（草色青）之后，
        线看着"发糊、跟底图分不开"。原因不是线变了，是**底图变"有颜色"了** ——
        原来那套线色是配浅米白底挑的。

     ⭐ 结论（也是容易漏掉的连带影响）：
        **换底图样式，必须回头复查所有画在它上面的元素。**
        包括线的颜色、透明度、描边，甚至点的类型色（见下方笔记）。

     这次同时动三个杠杆，让"我们的线"和"它的底图"分得更开：
       ① 颜色更深（明度拉开）—— 不是换色系，是同色系里压深
       ② 透明度提高（存在感变强）—— .55 在有色底上会被吃掉
       ③ 描边加粗（加一圈纸白"光晕"）—— 这是分得最干净的一招，
          因为它在线和底图之间插了一条明确的隔断 */
  var ARC_COLOR = '#6E4318';        /* 更深的暖褐（原 #8A6A45） */
  var ARC_OPACITY = 0.8;            /* 原 0.55 */

  /* 描边（"管子"质感 + 光晕）：只有 BezierCurve 支持。
     ⚠️ 如果线看着发糊、发脏，把 ARC_OUTLINE 改成 false 就退回纯色细线。 */
  var ARC_OUTLINE = true;
  var ARC_OUTLINE_COLOR = 'rgba(253, 250, 244, 0.95)';   /* 接近纸白，比原来更实 */
  var ARC_OUTLINE_WEIGHT = ARC_OUTLINE ? 2.6 : 0;        /* 原 1.5：加粗 → 光晕更明显 */

  /* ⚠️ 待观察（尚未改）：草色青是绿调底图，而「短期停留」的类型色是
     `#3D7A5F` 松绿 —— **绿点画在绿底上会不够醒目**。
     真要改就得动 model.js 的四色体系（那套色是 Day 8 改了三轮才定的），
     属于要单独决策的事，先记在这里，不顺手改。 */

  /**
   * 算一条"拱起来"的弧线路径（给 AMap.BezierCurve 用）
   *
   * 怎么拱：把两个控制点都往【垂直于连线的同一侧】推出去，
   *        分别放在 25% 和 75% 的位置 —— 这样曲线对称、单方向鼓出去。
   *
   * ⚠️ 这里有个**很容易写错**的地方：经度和纬度不能等量算！
   *   1 度纬度 ≈ 111 公里（到处都一样），
   *   但 1 度经度 ≈ 111 × cos(纬度) 公里 ——
   *   在乌鲁木齐（北纬 43.8°）只有约 80 公里，在赤道才是 111 公里。
   *   **直接拿经纬度当平面坐标算垂直方向，高纬度地区的弧线会歪掉**
   *   （看着像被斜着拉了一把）。
   *   所以这里先把经度按 cos(纬度) 缩放成"近似等距空间"，
   *   算完垂直方向和控制点，再换回经纬度。
   *
   * @param {{lng:number, lat:number}} from 起点（主城市锚点）
   * @param {{lng:number, lat:number}} to   终点（目标城市中心）
   * @returns {Array} BezierCurve 要的 path：
   *          [0] = 起点；[1] = [控制点1, 控制点2, 终点]（6 个数）
   */
  function arcPath(from, to) {
    var latMid = (from.lat + to.lat) / 2;
    /* cos(纬度)：经度方向的缩放系数。乘上它，经度差就近似变成"等距"的差 */
    var kx = Math.cos(latMid * Math.PI / 180);
    if (!kx) {
      kx = 1;   /* 防极端情况（理论上到不了两极） */
    }

    /* 1、换到"近似等距空间" */
    var ax = from.lng * kx, ay = from.lat;
    var bx = to.lng * kx,   by = to.lat;

    var dx = bx - ax;
    var dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy);

    /* 两点重合（理论上不该发生）→ 退回直线路径，不要产生 NaN */
    if (len === 0) {
      return [[from.lng, from.lat], [to.lng, to.lat]];
    }

    /* 2、垂直单位向量：把 (dx,dy) 转 90°，再乘 ARC_SIDE 决定朝哪边鼓 */
    var px = (-dy / len) * ARC_SIDE;
    var py = (dx / len) * ARC_SIDE;

    /* 3、推出去多少：跟两点距离成正比 —— 近的线拱得少，远的拱得多，
          这样长短不同的线看起来弧度才协调 */
    var push = len * ARC_BULGE;

    /* 4、控制点放在 25% / 75% 处，都往同一侧推 */
    function ctrlAt(t) {
      var cx = ax + dx * t + px * push;
      var cy = ay + dy * t + py * push;
      /* 换回经纬度：经度要把刚才乘的 kx 除回去 */
      return [cx / kx, cy];
    }

    var c1 = ctrlAt(0.25);
    var c2 = ctrlAt(0.75);

    /* 5、组装成 BezierCurve 要的格式：
          第一个元素是起点；第二个元素是「控制点1、控制点2、终点」
          （高德的 path 是**扁平的坐标数组**，一段最多两个控制点） */
    return [
      [from.lng, from.lat],
      [c1[0], c1[1], c2[0], c2[1], to.lng, to.lat]
    ];
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

    /* 画线用哪个类：优先贝塞尔曲线（弧线），拿不到就退回直线
       ⚠️ 为什么要这个兜底：万一是旧版 SDK 里没有 BezierCurve，
          **不兜底的话 7 条线会全部消失** —— 那比"线是直的"严重得多。
          （Day 8 加练 · 步骤③） */
    var useCurve = typeof AMap.BezierCurve === 'function';
    if (!useCurve) {
      console.warn('[TripMemo] 当前高德 SDK 没有 BezierCurve，连线退回直线');
    }

    stats.forEach(function (item) {
      /* 主城市自己的点不连线（验收标准 17） */
      if (Model.isSameCity(item.city, mainCity.city)) {
        return;
      }

      /* 线的基础样式（弧线和直线共用）
         颜色 / 透明度用 ARC_COLOR / ARC_OPACITY 两个常量，
         它们是为 fresh 底图重新配过的（见常量区的说明）。 */
      var lineOptions = {
        strokeColor: ARC_COLOR,
        strokeWeight: Model.lineWidthByMonths(item.totalMonths),  /* 线宽 ∝ 累计停留时长（验收标准 18） */
        strokeOpacity: ARC_OPACITY,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 100
      };

      if (useCurve) {
        lineOptions.path = arcPath(mainCity, item);
        /* 描边：给线镶一圈浅色边，做出"管子"的厚度感 */
        lineOptions.isOutline = ARC_OUTLINE;
        lineOptions.outlineColor = ARC_OUTLINE_COLOR;
        lineOptions.borderWeight = ARC_OUTLINE_WEIGHT;
        lines.push(new AMap.BezierCurve(lineOptions));
      } else {
        lineOptions.path = [
          [mainCity.lng, mainCity.lat],
          [item.lng, item.lat]
        ];
        lines.push(new AMap.Polyline(lineOptions));
      }
    });

    if (lines.length) {
      map.add(lines);
    }
    console.log('[TripMemo] 已画 ' + lines.length + ' 条'
      + (useCurve ? '弧线' : '直线') + '，从「' + mainCity.city + '」出发');
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
    elLoading = document.getElementById('map-loading');
    elError = document.getElementById('map-error');
    elErrorMsg = document.getElementById('map-error-msg');

    if (!elCanvas) {
      return;
    }

    renderFilterBar();

    /* 先亮出"加载中" —— 地图 SDK 要联网下载，这期间画布是全白的 */
    showLoading();

    loadAmapSDK(SDK_TIMEOUT_MS)
      .then(function () {
        /* ⚠️ initMap() 可能抛异常（比如配置里样式 ID 写错），
           放在 Promise 链里抛出的错误会被下面的 catch 接住，
           所以这里不额外包 try/catch，让失败统一走一条路。 */
        initMap();
        initSearch();
        initMainCityUI();
        refresh();
        resizeMap();
        hideLoading();
        console.log('[TripMemo] 地图已就绪');
      })
      .catch(function (err) {
        /* 地图起不来时，把原因直接显示在页面上，别让它静默失败 */
        console.error('[TripMemo] 地图初始化失败：', err);
        showError(err.message);
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
    highlightCity: highlightCity,
    /* 暴露出来只为**单独验证弧度算得对不对**（Day 8 加练 · 步骤③）。
       弧线算法里有"经纬度要按 cos(纬度) 缩放"这种容易写错的地方，
       不抽出来就没法实算，只能靠肉眼 —— 那就说不清是"算法对但难看"
       还是"算法本身就错"。 */
    arcPath: arcPath
  };

}(window));

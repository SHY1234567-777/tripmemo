/* ============================================================
   TripMemo 地点列表视图（js/places.js）

   职责：把地点按「城市」归拢，回答"我在这座城市生活过哪些地方"。
   规则（PRD 5.3）：
     · 按城市分组，可展开 / 收起
     · 显示每个城市的地点数量
     · 点击城市名时，地图上对应城市的点高亮

   Day 7 · 步骤 2c-②
   Day 8 · 美化改版：从"一长条折叠列表"改成「城市卡片网格」
          —— 每个城市一张卡，卡头有地点数 + 总停留时长 + 时长占比条
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;
  var Store = global.TripMemoStore;

  var elList = null;
  var elEmpty = null;

  /* 时长占比条的换算上限：停留满 10 年（120 个月）= 满格
     ⚠️ 别借 Model.LINE_MAX —— 那是「线宽像素上限（8px）」，不是月数，
        借过来算比例会把所有城市都撑成满格。 */
  var BAR_MONTHS_FULL = 120;

  /* 入场动画：每张卡片比前一张晚 55ms 落进来，形成"翻页"的节奏
     ⚠️ 上限 8 步 —— 城市多的时候（比如 30 个）不能一路加到 1.6 秒，
        那样最后几张要等太久，用户会觉得卡。超过 8 张之后统一用同一个延迟。 */
  var FLIP_STEP_MS = 55;
  var FLIP_STEP_MAX = 8;

  /* ------------------------------------------------------------
     一、把地点按城市分组
     ------------------------------------------------------------ */

  /**
   * @returns {Array<{city: string, places: Array}>}
   *          按「地点数降序，同数量按城市名」排列
   *
   * 分组用的是「规范化城市名」—— 这样「武汉市」和「武汉」不会被拆成两组。
   * 显示的仍是用户实际填写的写法（取该组里第一次出现的那个）。
   */
  function groupByCity(places) {
    var bucket = {};
    var order = [];

    places.forEach(function (place) {
      /* 城市为空的归到一个「城市待补」组，不让它们凭空消失
         （对应 TECH_DESIGN 待反馈 PRD 的问题 #1、#2） */
      var raw = place.city || '城市待补';
      var key = Model.normalizeCity(raw) || '城市待补';

      if (!bucket[key]) {
        bucket[key] = { city: raw, places: [] };
        order.push(key);
      }
      bucket[key].places.push(place);
    });

    return order
      .map(function (key) { return bucket[key]; })
      .sort(function (a, b) {
        if (b.places.length !== a.places.length) {
          return b.places.length - a.places.length;
        }
        return a.city.localeCompare(b.city);
      });
  }

  /* ------------------------------------------------------------
     二、小工具（Day 8 新增）
     ------------------------------------------------------------ */

  /**
   * 画地点条目的图片位
   * ⚠️ 为什么在 timeline.js 里也有一份类似的代码，不抽成公共函数？
   *    因为两处的尺寸和样式完全不同（时间轴是 88×88 大方块，
   *    这里是 56×56 小方块），强行抽公共函数反而要多传一堆参数。
   *    只有几行代码，各自持有更清楚。等以后图片功能真做了，
   *    再统一抽成 thumbnail.js 也不迟。
   * @param {Object} place
   * @returns {HTMLElement}
   */
  function makeThumb(place) {
    var thumb = document.createElement('div');
    thumb.className = 'place-thumb';

    var first = (place.images && place.images.length) ? place.images[0] : '';
    if (first) {
      var img = document.createElement('img');
      img.className = 'place-thumb-img';
      img.src = first;
      img.alt = place.name;
      thumb.appendChild(img);
      return thumb;
    }

    var hint = document.createElement('span');
    hint.className = 'place-thumb-hint';
    hint.textContent = '暂无';
    thumb.appendChild(hint);
    return thumb;
  }

  /**
   * 把总月数说成人话：'4 年 2 个月'
   * 为什么不用 stayLabel 那套 '2019-09 ~ 2021-06'：
   * 卡片头部要给的是"这座城市我一共待了多久"，是汇总，不是起止。
   * @param {number} months
   * @returns {string} 没有时长时返回空串（调用方据此决定要不要显示这一行）
   */
  function monthsLabel(months) {
    if (!months || months <= 0) {
      return '';
    }
    var y = Math.floor(months / 12);
    var m = months % 12;
    if (y === 0) {
      return m + ' 个月';
    }
    return m === 0 ? (y + ' 年') : (y + ' 年 ' + m + ' 个月');
  }

  /**
   * 时长占比条该填多宽（0~1）
   * 用平方根映射，和地图点大小 / 线宽同一套算法 —— 视觉语言统一
   */
  function barRatio(months) {
    if (!months || months <= 0) {
      return 0;
    }
    var capped = Math.min(months, BAR_MONTHS_FULL);
    return Math.sqrt(capped / BAR_MONTHS_FULL);
  }

  /* ------------------------------------------------------------
     三、渲染
     ------------------------------------------------------------ */
  function render() {
    if (!elList) {
      return;
    }

    var places = Store.listPlaces();
    var isEmpty = places.length === 0;

    elEmpty.hidden = !isEmpty;
    elList.hidden = isEmpty;

    if (isEmpty) {
      elList.innerHTML = '';
      return;
    }

    elList.innerHTML = '';

    groupByCity(places).forEach(function (group, index) {
      /* 用浏览器原生的 details/summary 实现"展开 / 收起"，
         不用自己写状态管理 —— 少写代码，少出 bug */
      var box = document.createElement('details');
      box.className = 'city-group';

      /* ⚠️ Day 10：改成**默认收起**（原来是 `true`）。
         为什么改：Grid 的每一行高度天生 = 那一排最高的卡片，
         所以只要同一排两张卡高度不同，就一定会空出一块 ——
         `align-items` 只能决定这块空白出现在「卡片里」还是「卡片下」，**不能让它消失**。
         （示例数据里武汉有 3 个地点、其余 10 个城市各 1 个，差异被放得最大。）

         收起之后每张卡都只剩标题行（约 78px）→ **高度完全一致 → 一条空隙都没有**，
         而且排与排之间不会再错落、展开时也不会跳动。

         ⭐ 这其实也是这个页面**本来的设计意图**：
         `.city-head::after` 里写着「展开 ▾」/「收起 ▴」两个状态，
         而「展开 ▾」就是给"收起"准备的 —— 是 Day 8 把它设成默认展开才引出的问题。 */
      box.open = false;

      /* 入场动画的延迟：第 N 张卡晚 N×55ms 落进来（上限 8 步，见常量说明）
         ⚠️ 用 Math.min 卡上限，不要让第 30 张卡等 1.6 秒 */
      box.style.animationDelay = (Math.min(index, FLIP_STEP_MAX) * FLIP_STEP_MS) + 'ms';

      var head = document.createElement('summary');
      head.className = 'city-head';

      var name = document.createElement('span');
      name.className = 'city-name';
      name.textContent = group.city;

      var count = document.createElement('span');
      count.className = 'city-count';
      count.textContent = group.places.length + ' 个地点';

      head.appendChild(name);
      head.appendChild(count);

      /* 第二行：总停留时长 + 时长占比条
         —— 把「点大小 / 线宽表示时长」这条主线在列表里也讲一遍，
            用的是同一套平方根映射，所以条的长短和地图上的线粗细是同源的 */
      var totalMonths = group.places.reduce(function (sum, place) {
        return sum + Model.monthsOfStay(place);
      }, 0);

      var sub = document.createElement('span');
      sub.className = 'city-sub';

      var bar = document.createElement('span');
      bar.className = 'city-bar';

      var fill = document.createElement('i');
      fill.className = 'city-bar-fill';
      fill.style.width = Math.round(barRatio(totalMonths) * 100) + '%';
      bar.appendChild(fill);

      /* ⚠️ totalMonths 为 0 有**两种**情况，必须分开（Day 11 重做修）：
         ① 一个起始时间都没填 → 真·未填
         ② 填了，但加起来不足 1 个月（比如只填了一个点、起止落在同一个月）
         以前这两种都显示「未填时长」—— 第 ② 种是**在骗人**：用户明明填了。
         判据：这座城市里有没有**任何一个**点填了 startMonth。 */
      var hasAnyMonth = group.places.some(function (place) {
        return !!place.startMonth;
      });

      var timeText = monthsLabel(totalMonths);
      var timeSpan = document.createElement('span');
      timeSpan.className = 'city-months';
      if (timeText) {
        timeSpan.textContent = timeText;
      } else {
        /* 显示"0 个月"没意义 —— 要么说"不足 1 个月"，要么老实说没填 */
        timeSpan.textContent = hasAnyMonth ? '不足 1 个月' : '未填时长';
      }
      sub.appendChild(timeSpan);
      sub.appendChild(bar);

      head.appendChild(sub);
      box.appendChild(head);

      /* 点击城市名 → 让地图上该城市的点高亮（PRD 验收标准 10） */
      head.addEventListener('click', function () {
        if (global.TripMemoMap && global.TripMemoMap.highlightCity) {
          global.TripMemoMap.highlightCity(group.city);
        }
      });

      /* 城市下的地点条目 */
      group.places.forEach(function (place) {
        var row = document.createElement('div');
        row.className = 'place-row';

        /* ---- 甲方案：图片位挂在【地点】上（不是城市上）----
           因为 PRD 第六章的 images 字段是挂在 place 上的，
           照片本来就是"某个地方的回忆"，不是"整座城市的封面"。
           现在 images 都是空数组 → 画占位框；以后有值了自动变真图。 */
        row.appendChild(makeThumb(place));

        var body = document.createElement('div');
        body.className = 'place-body';

        var title = document.createElement('span');
        title.className = 'place-name';
        title.textContent = place.name;

        var meta = document.createElement('span');
        meta.className = 'place-meta';

        /* 类型色点：和地图上的点同色，一眼对上 */
        var dot = document.createElement('i');
        dot.className = 'type-dot';
        dot.style.backgroundColor = Model.TYPE_COLORS[place.type] || Model.TYPE_COLORS.long;

        meta.appendChild(dot);
        meta.appendChild(document.createTextNode(
          Model.typeLabel(place.type) + ' ｜ ' + Model.stayLabel(place)
        ));

        body.appendChild(title);
        body.appendChild(meta);
        row.appendChild(body);

        /* 打开「地点详情抽屉」—— 鼠标和键盘共用这一个入口。
           ⚠️ Day 10 改：原来这里打开的是**可编辑的三态弹窗**，
              现在改成打开**只读抽屉**（抽屉里点「编辑这个地点」再回弹窗）。
           ⚠️ 兜底：万一抽屉模块没加载成功，退回原来的弹窗 ——
              不能让用户遇到"点一下毫无反应"这种事。 */
        function openRow() {
          if (global.TripMemoDrawer && global.TripMemoDrawer.open(place.id)) {
            return;
          }
          if (global.TripMemoDetail) {
            global.TripMemoDetail.openView(place.id);
          }
        }

        /* ⚠️ 键盘可达性（Day 9 修复）
           原来只有 click 监听，而 `<div class="place-row">` **不可聚焦** →
           **键盘用户完全到不了地点条目**，只能靠城市头部（那是原生可聚焦的 <summary>）。
           同时间轴卡片：补 tabindex="0" + role="button" + Enter/空格 的 keydown。 */
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'button');

        row.addEventListener('click', openRow);
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();   /* 空格不拦会滚动页面 */
            openRow();
          }
        });

        box.appendChild(row);
      });

      elList.appendChild(box);
    });
  }

  /* ------------------------------------------------------------
     四、初始化
     ------------------------------------------------------------ */
  function init() {
    elList = document.getElementById('places-list');
    elEmpty = document.getElementById('places-empty');
    if (!elList) {
      return;
    }

    document.addEventListener('data:change', render);

    render();
  }

  global.TripMemoPlaces = { init: init, render: render, monthsLabel: monthsLabel };

}(window));

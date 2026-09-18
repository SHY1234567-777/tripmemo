/* ============================================================
   TripMemo 地点列表视图（js/places.js）

   职责：把地点按「城市」归拢，回答"我在这座城市生活过哪些地方"。
   规则（PRD 5.3）：
     · 按城市分组，可展开 / 收起
     · 显示每个城市的地点数量
     · 点击城市名时，地图上对应城市的点高亮

   Day 7 · 步骤 2c-②
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;
  var Store = global.TripMemoStore;

  var elList = null;
  var elEmpty = null;

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
     二、渲染
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

    groupByCity(places).forEach(function (group) {
      /* 用浏览器原生的 details/summary 实现"展开 / 收起"，
         不用自己写状态管理 —— 少写代码，少出 bug */
      var box = document.createElement('details');
      box.className = 'city-group';
      box.open = true;   /* 默认展开：一眼能看到全部 */

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

        var title = document.createElement('span');
        title.className = 'place-name';
        title.textContent = place.name;

        var meta = document.createElement('span');
        meta.className = 'place-meta';
        meta.textContent = Model.typeLabel(place.type) + ' ｜ ' + Model.stayLabel(place);

        row.appendChild(title);
        row.appendChild(meta);

        /* 点条目 → 打开「查看态」弹窗 */
        row.addEventListener('click', function () {
          if (global.TripMemoDetail) {
            global.TripMemoDetail.openView(place.id);
          }
        });

        box.appendChild(row);
      });

      elList.appendChild(box);
    });
  }

  /* ------------------------------------------------------------
     三、初始化
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

  global.TripMemoPlaces = { init: init, render: render };

}(window));

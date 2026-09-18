/* ============================================================
   TripMemo 时间轴视图（js/timeline.js）

   职责：把地点按「停留开始时间」倒序排成一列，像翻日记一样回看。
   规则（PRD 5.2）：
     · 倒序（最近的在最上，最早的在最下）
     · 不含「想去」类型 —— 时间轴代表"已经走过的路"（验收标准 32）
     · 空数据时显示空状态文案

   Day 7 · 步骤 2c-②
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;
  var Store = global.TripMemoStore;

  /* 卡片上正文摘要截取多少字（PRD 技术设计待反馈项 #3 的建议值） */
  var SUMMARY_LEN = 40;

  var elList = null;
  var elEmpty = null;

  /* ------------------------------------------------------------
     一、小工具
     ------------------------------------------------------------ */

  /** 截取正文摘要 */
  function summary(text) {
    if (!text) {
      return '';
    }
    var oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > SUMMARY_LEN
      ? oneLine.slice(0, SUMMARY_LEN) + '…'
      : oneLine;
  }

  /** 排序键：停留开始时间（'YYYY-MM' 字符串比较就等于时间比较） */
  function sortKey(place) {
    return place.startMonth || '';
  }

  /* ------------------------------------------------------------
     二、渲染
     ------------------------------------------------------------ */
  function render() {
    if (!elList) {
      return;
    }

    /* 1、取出全部地点，剔除「想去」 */
    var places = Store.listPlaces().filter(function (place) {
      return place.type !== Model.WISHLIST_KEY;
    });

    /* 2、按停留开始时间倒序；没填开始时间的排到最后 */
    places.sort(function (a, b) {
      return sortKey(b).localeCompare(sortKey(a));
    });

    /* 3、空状态切换 */
    var isEmpty = places.length === 0;
    elEmpty.hidden = !isEmpty;
    elList.hidden = isEmpty;

    if (isEmpty) {
      elList.innerHTML = '';
      return;
    }

    /* 4、逐条画卡片 */
    elList.innerHTML = '';
    places.forEach(function (place) {
      var card = document.createElement('article');
      card.className = 'timeline-card';

      /* 停留时段（左边那条竖线上的小标签） */
      var when = document.createElement('div');
      when.className = 'timeline-when';
      when.textContent = place.startMonth || '时间未填';

      /* 卡片主体 */
      var body = document.createElement('div');
      body.className = 'timeline-body';

      var head = document.createElement('h3');
      head.className = 'timeline-name';
      head.textContent = place.name;

      var meta = document.createElement('p');
      meta.className = 'timeline-meta';
      meta.textContent = place.city + ' ｜ ' + Model.typeLabel(place.type)
        + ' ｜ ' + Model.stayLabel(place);

      body.appendChild(head);
      body.appendChild(meta);

      /* 正文摘要 */
      var text = summary(place.note);
      if (text) {
        var note = document.createElement('p');
        note.className = 'timeline-note';
        note.textContent = text;
        body.appendChild(note);
      }

      /* 标签 */
      if (place.tags && place.tags.length) {
        var tagWrap = document.createElement('p');
        tagWrap.className = 'tag-row';
        place.tags.forEach(function (tag) {
          var span = document.createElement('span');
          span.className = 'tag';
          span.textContent = tag;
          tagWrap.appendChild(span);
        });
        body.appendChild(tagWrap);
      }

      card.appendChild(when);
      card.appendChild(body);

      /* 点卡片 → 打开「查看态」弹窗（PRD 验收标准 33） */
      card.addEventListener('click', function () {
        if (global.TripMemoDetail) {
          global.TripMemoDetail.openView(place.id);
        }
      });

      elList.appendChild(card);
    });
  }

  /* ------------------------------------------------------------
     三、初始化
     ------------------------------------------------------------ */
  function init() {
    elList = document.getElementById('timeline-list');
    elEmpty = document.getElementById('timeline-empty');
    if (!elList) {
      return;
    }

    /* 数据变了就重画 */
    document.addEventListener('data:change', render);

    render();
  }

  global.TripMemoTimeline = { init: init, render: render };

}(window));

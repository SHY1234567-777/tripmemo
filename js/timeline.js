/* ============================================================
   TripMemo 时间轴视图（js/timeline.js）

   职责：把地点按「停留开始时间」倒序排成一列，像翻日记一样回看。
   规则（PRD 5.2）：
     · 倒序（最近的在最上，最早的在最下）
     · 不含「想去」类型 —— 时间轴代表"已经走过的路"（验收标准 32）
     · 空数据时显示空状态文案

   Day 7 · 步骤 2c-②
   Day 8 · 美化改版：
     ① 加「按年分组」（年份按开始月份归年）
     ② 卡片重做成"真卡片"：左侧图片位 + 右侧精简文字（为后续图片功能留好结构）
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;
  var Store = global.TripMemoStore;

  /* 卡片上正文摘要截取多少字（PRD 技术设计待反馈项 #3 的建议值）
     Day 8 砍信息后，摘要只在"没有标签"时才显示，所以可以留长一点 */
  var SUMMARY_LEN = 54;

  /* 没有填写开始时间的地点，归到这个组（放最下面） */
  var NO_YEAR_KEY = '__none__';
  var NO_YEAR_LABEL = '时间未填';

  /* 图片位：目前 PRD 第六章第 10 项 images 只留了字段未实现，
     所以这里画一个空的占位框。等 Day 8-28 的图片功能做完，
     只要把 paintThumb() 改成真的 <img> 即可，卡片结构不用动。 */
  var THUMB_EMPTY_TEXT = '暂无照片';

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

  /**
   * 取"归年"的年份
   * ⚠️ 按【开始月份】归年，不是结束月份 ——
   *    比如 2025-10 到 2026-03，算作 2025 年的事，
   *    因为"我什么时候去的"才是回忆的直觉。
   * @returns {string} 'YYYY'，没填时间时返回 NO_YEAR_KEY
   */
  function yearOf(place) {
    var ym = place.startMonth || '';
    return /^\d{4}-/.test(ym) ? ym.slice(0, 4) : NO_YEAR_KEY;
  }

  /* ------------------------------------------------------------
     二、渲染
     ------------------------------------------------------------ */

  /**
   * 画卡片左侧的图片位
   * 现在返回一个空的占位框；等图片功能做完，在这里换成真实缩略图
   * @param {Object} place
   * @returns {HTMLElement}
   */
  function makeThumb(place) {
    var thumb = document.createElement('div');
    thumb.className = 'timeline-thumb';

    /* 已经存了图片的（未来）→ 画图；现在数据里 images 都是空数组 → 画占位 */
    var first = (place.images && place.images.length) ? place.images[0] : '';
    if (first) {
      var img = document.createElement('img');
      img.className = 'timeline-thumb-img';
      img.src = first;
      img.alt = place.name;
      thumb.appendChild(img);
      return thumb;
    }

    var hint = document.createElement('span');
    hint.className = 'timeline-thumb-hint';
    hint.textContent = THUMB_EMPTY_TEXT;
    thumb.appendChild(hint);
    return thumb;
  }

  /**
   * 把地点按年份分组
   * @param {Array} places 已排好序的地点
   * @returns {Array} [{ year, label, places: [...] }]，年份新的在前
   */
  function groupByYear(places) {
    var groups = [];
    var index = {};     /* year → 组在 groups 里的下标 */

    places.forEach(function (place) {
      var year = yearOf(place);
      if (index[year] === undefined) {
        index[year] = groups.length;
        groups.push({
          year: year,
          label: year === NO_YEAR_KEY ? NO_YEAR_LABEL : year + ' 年',
          places: []
        });
      }
      groups[index[year]].places.push(place);
    });

    /* 「时间未填」永远排最后（其余已按开始时间倒序，天然就是新年份在前） */
    groups.sort(function (a, b) {
      if (a.year === NO_YEAR_KEY) {
        return 1;
      }
      if (b.year === NO_YEAR_KEY) {
        return -1;
      }
      return b.year.localeCompare(a.year);
    });

    return groups;
  }

  /** 画一张地点卡片 */
  function makeCard(place) {
    var card = document.createElement('article');
    card.className = 'timeline-card';

    /* ---- 左：图片位（现在是个空框，以后放照片） ---- */
    card.appendChild(makeThumb(place));

    /* ---- 右：文字区 ---- */
    var text = document.createElement('div');
    text.className = 'timeline-text';

    /* 1、地点名 + 停留起始时间（只显示年月，完整时段在 hover 标题里） */
    var headRow = document.createElement('div');
    headRow.className = 'timeline-head';

    var name = document.createElement('h3');
    name.className = 'timeline-name';
    name.textContent = place.name;

    var when = document.createElement('span');
    when.className = 'timeline-when';
    when.textContent = place.startMonth || '时间未填';
    when.title = Model.stayLabel(place);   /* 想看完整时段，鼠标停上去 */

    headRow.appendChild(name);
    headRow.appendChild(when);

    /* 2、一行元信息：城市 ｜ 类型 ｜ 停留时长（Day 8 砍信息前是独立一段，现在并进这一行）
       — 类型用颜色点表示，省掉一个词 */
    var meta = document.createElement('p');
    meta.className = 'timeline-meta';

    var dot = document.createElement('i');
    dot.className = 'type-dot';
    dot.style.backgroundColor = Model.TYPE_COLORS[place.type] || Model.TYPE_COLORS.long;

    var city = document.createElement('span');
    city.className = 'timeline-city';
    city.textContent = place.city || '未填城市';

    var stay = document.createElement('span');
    stay.className = 'timeline-stay';
    stay.textContent = Model.stayLabel(place);

    meta.appendChild(dot);
    meta.appendChild(city);
    meta.appendChild(document.createTextNode(' ｜ ' + Model.typeLabel(place.type) + ' ｜ '));
    meta.appendChild(stay);

    text.appendChild(headRow);
    text.appendChild(meta);

    /* 3、正文摘要 —— 只在【没有标签】时显示（有标签就让标签代表这张卡） */
    var hasTags = place.tags && place.tags.length;
    var summaryText = summary(place.note);
    if (summaryText && !hasTags) {
      var note = document.createElement('p');
      note.className = 'timeline-note';
      note.textContent = summaryText;
      text.appendChild(note);
    }

    /* 4、标签 */
    if (hasTags) {
      var tagWrap = document.createElement('p');
      tagWrap.className = 'tag-row';
      place.tags.forEach(function (tag) {
        var span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tagWrap.appendChild(span);
      });
      text.appendChild(tagWrap);
    }

    card.appendChild(text);

    /* 点卡片 → 打开「查看态」弹窗（PRD 验收标准 33） */
    card.addEventListener('click', function () {
      if (global.TripMemoDetail) {
        global.TripMemoDetail.openView(place.id);
      }
    });

    return card;
  }

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

    elList.innerHTML = '';
    if (isEmpty) {
      return;
    }

    /* 4、按年分组，每年一组：一条时间竖线 + 年份节点 + 该年的卡片 */
    groupByYear(places).forEach(function (group) {
      var section = document.createElement('section');
      section.className = 'timeline-year';

      var label = document.createElement('h2');
      label.className = 'timeline-year-label';
      label.textContent = group.label;

      var list = document.createElement('div');
      list.className = 'timeline-year-list';

      group.places.forEach(function (place) {
        list.appendChild(makeCard(place));
      });

      section.appendChild(label);
      section.appendChild(list);
      elList.appendChild(section);
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

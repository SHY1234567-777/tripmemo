/* ============================================================
   TripMemo 地点详情抽屉（js/drawer.js）

   点「地点列表」里的某个地点 → 从右侧铺开这个抽屉，左侧留一条变暗的底。

   规则（Day 10 由 shy 定）：
     · 粒度 = **地点**（不是城市）
     · **只读** —— 要改内容，点底部的按钮回到原来的三态弹窗（PRD 5.4）
     · 尺寸 / 结构参考他给的图：铺满大半屏、左侧留一条暗底
     · 本轮是**骨架版**：照片相关区域先不做（照片上传排在 Day 8–28，见 PRD 4.3）

   ⚠️ 为什么单独开一个文件，而不塞进 detail.js：
      detail.js 管的是「**可编辑**的三态弹窗」，这里是「**只读**的展示抽屉」，
      职责不同；拆成两个模块以后，改一个不会碰另一个。
      （TECH_DESIGN 2.3 的约定：一个视图 / 组件一个模块。）
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;
  var Store = global.TripMemoStore;

  /* 标签页。
     ⚠️ 顺序（Day 10 由 shy 定）：**照片排在最前** ——
        照片会是这个抽屉的主要内容，位置要留给它。

     ⚠️ 但**默认打开的是「故事」**，不是第一个。理由：
        照片功能还没做（PRD 4.3），一进来就落在"还没做"的占位页签上体验很差。
        等照片真能存进来之后，把下面 open() 里的 activeTab 初值改成 'photo' 就行（一行）。

     ⚠️「照片」页签的内容**明确写成占位说明**，不是忘了做 ——
        留着它既让结构和参考图一致，也**把缺口摆在明面上**。 */
  var TABS = [
    { key: 'photo',    label: '照片' },
    { key: 'story',    label: '故事' },
    { key: 'timeline', label: '时间轴' }
  ];

  var el = {};
  var currentId = null;
  /* ⭐ Day 21：照片做好之后，默认落在「照片」——
     ⚠️ 顺序是 Day 10 就定下的：**照片排在最前**，它才是这个抽屉的主要内容。 */
  var activeTab = 'photo';

  /* 打开抽屉之前焦点在哪 —— 关掉之后要还回去，否则键盘用户会"掉"到页面开头 */
  var lastFocused = null;

  /* ------------------------------------------------------------
     一、小工具
     ------------------------------------------------------------ */

  /** 把"停留月数"说成人话：'4 年 2 个月'
   *  ⚠️ 这里和 places.js 的 monthsLabel 是重复的（都只有几行）。
   *     故意先不抽公共函数：只有 5 行，抽出去反而要多传参数；
   *     等第三处真的需要它时再抽。 */
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

  function clear(node) {
    if (node) {
      node.innerHTML = '';
    }
  }

  function makeEmpty(text) {
    var p = document.createElement('p');
    p.className = 'drawer-empty';
    p.textContent = text;
    return p;
  }

  /* ------------------------------------------------------------
     二、各块渲染
     ------------------------------------------------------------ */

  /** 主视觉区。现在还没有照片，靠排版撑住这一块 */
  function renderHero(place) {
    var city = place.city || '城市待补';
    /* 左上角那行小字：参考图是 '2026.05 · China'，我们放"起始年月 · 城市" */
    el.kicker.textContent =
      (place.startMonth ? place.startMonth.replace('-', '.') + ' · ' : '') + city;
    el.title.textContent = place.name;
    el.sub.textContent = Model.typeLabel(place.type)
      + '　' + (place.type === Model.WISHLIST_KEY ? '还没去过' : Model.stayLabel(place));

    renderHeroPhoto(place);
  }

  /**
   * ⭐ 把第一张照片铺到抽屉顶部当背景（Day 21）
   *
   * ⭐ 为什么用"第一张"：用户加照片的顺序就是"最重要的一张放前面" ——
   *    和"删掉一张就没封面了"相比，"第一张自动当封面"零操作、最省心。
   * ⚠️ 「手动指定封面」记进待办了（要给 images 加一个 coverIndex 字段）。
   *
   * ⚠️ 没有照片 → 把背景清掉、类名去掉，**恢复原来的样子**（不是留一块空白）。
   */
  function renderHeroPhoto(place) {
    if (!el.hero) {
      return;
    }

    var first = (place.images && place.images.length) ? place.images[0] : '';

    /* ⚠️ 每次都要先清 —— 上一个地点的照片可能还挂着 */
    el.hero.style.removeProperty('--hero-photo');
    el.hero.classList.remove('has-photo');

    if (!first) {
      return;
    }

    /* ⚠️ 先乐观地加上类（文字变浅色）—— 等链接回来才换背景的话，
       中间会有一瞬"深色背景 + 深色文字"看不清。 */
    el.hero.classList.add('has-photo');

    Store.resolvePhotoUrls([first]).then(function (list) {
      var url = list.length ? list[0].url : '';
      if (!url) {
        /* ⭐ 换不到链接 → 撤回，恢复原样 */
        el.hero.classList.remove('has-photo');
        return;
      }
      el.hero.style.setProperty('--hero-photo', 'url("' + url + '")');
    }).catch(function (err) {
      console.warn('[TripMemo] 抽屉背景照片换取失败：', err);
      el.hero.classList.remove('has-photo');
    });
  }

  /** 一条只读信息（三格）—— 对应参考图里那条"累计访问 / 第一次到访 / 最近到访" */
  function renderStats(place) {
    clear(el.stats);

    var isWish = (place.type === Model.WISHLIST_KEY);
    var months = Model.monthsOfStay(place);
    var duration = isWish ? '—' : (months > 0 ? monthsLabel(months) : '不足 1 个月');

    [
      ['地点类型', Model.typeLabel(place.type)],
      ['停留时段', isWish ? '下一站（还没去过）' : Model.stayLabel(place)],
      ['停留时长', duration]
    ].forEach(function (pair) {
      var box = document.createElement('div');
      box.className = 'drawer-stat';

      var dt = document.createElement('dt');
      dt.className = 'drawer-stat-label';
      dt.textContent = pair[0];

      var dd = document.createElement('dd');
      dd.className = 'drawer-stat-value';
      dd.textContent = pair[1] || '—';

      box.appendChild(dt);
      box.appendChild(dd);
      el.stats.appendChild(box);
    });
  }

  function renderTabs() {
    clear(el.tabs);
    TABS.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drawer-tab' + (tab.key === activeTab ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', tab.key === activeTab ? 'true' : 'false');
      btn.textContent = tab.label;
      btn.addEventListener('click', function () {
        activeTab = tab.key;
        renderTabs();
        renderBody();
      });
      el.tabs.appendChild(btn);
    });
  }

  function renderBody() {
    clear(el.body);
    var place = Store.getPlace(currentId);
    if (!place) {
      return;
    }

    /* ---- 故事：回忆正文 + 标签 ---- */
    if (activeTab === 'story') {
      if (place.note) {
        var text = document.createElement('p');
        text.className = 'drawer-text';
        text.textContent = place.note;
        el.body.appendChild(text);
      } else {
        el.body.appendChild(makeEmpty('这个地点还没有写回忆。'));
      }

      if (place.tags && place.tags.length) {
        var row = document.createElement('div');
        row.className = 'tag-row drawer-tag-row';
        place.tags.forEach(function (tag) {
          var span = document.createElement('span');
          span.className = 'tag';
          span.textContent = tag;
          row.appendChild(span);
        });
        el.body.appendChild(row);
      }
      return;
    }

    /* ---- 时间轴：骨架版先只摆"起点 / 终点"两行。
           以后要做成真正的竖向时间轴（复用时间轴视图那套竖线 + 圆点）。 ---- */
    if (activeTab === 'timeline') {
      var list = document.createElement('ul');
      list.className = 'drawer-timeline';
      [
        ['开始', place.startMonth || '未填'],
        ['结束', place.endMonth || (place.startMonth ? '至今' : '未填')]
      ].forEach(function (pair) {
        var li = document.createElement('li');
        li.textContent = pair[0] + '：' + pair[1];
        list.appendChild(li);
      });
      el.body.appendChild(list);
      return;
    }

    /* ---- ⭐ 照片（Day 21 实装）----
       ⚠️ 数据库里存的是 **fileID**（cloud:// 开头），不是能直接显示的网址 ——
          要先用 Store.resolvePhotoUrls() 换成链接才能放进 <img src>。
       ⭐ 所以流程是：**先按数量把格子摆出来（占位）→ 异步把图填进去**，
          这样点了页签立刻有反馈，不用等网络。 */
    var grid = document.createElement('div');
    grid.className = 'drawer-photo-grid';

    var fileIDs = (place.images || []).filter(function (x) { return !!x; });

    if (!fileIDs.length) {
      grid.appendChild(makeEmpty('这个地方还没有照片。'));
      el.body.appendChild(grid);
      return;
    }

    /* ⚠️ 用一个 map 记住"哪个格子对应哪个 fileID" ——
       换链接是异步的，回来时要能找到该填哪一格。 */
    var cellByFileID = {};

    fileIDs.forEach(function (fileID) {
      var cell = document.createElement('a');
      cell.className = 'drawer-photo-item';
      cell.target = '_blank';          /* ⭐ 点开看大图：直接新标签打开，不做灯箱 */
      cell.rel = 'noopener';           /* ⚠️ 安全：新窗口别能反控本页 */
      cell.setAttribute('aria-label', '查看大图');

      var img = document.createElement('img');
      img.alt = '';
      cell.appendChild(img);

      grid.appendChild(cell);
      cellByFileID[fileID] = { cell: cell, img: img };
    });
    el.body.appendChild(grid);

    /* ⭐ 异步换成真实链接 */
    Store.resolvePhotoUrls(fileIDs).then(function (list) {
      list.forEach(function (item) {
        var ref = cellByFileID[item.fileID];
        if (!ref || !item.url) {
          return;
        }
        ref.img.src = item.url;
        ref.cell.href = item.url;      /* 点开就是原图 */
      });
      /* ⚠️ 一张都没换成 → 说明云存储这条路出问题了，别留一片空白 */
      var shown = grid.querySelectorAll('img[src]').length;
      if (!shown) {
        clear(grid);
        grid.appendChild(makeEmpty('照片暂时显示不出来（可能网络或权限问题）。'));
      }
    });
  }

  /* ------------------------------------------------------------
     三、开 / 关
     ------------------------------------------------------------ */
  function open(placeId) {
    var place = Store.getPlace(placeId);
    if (!place) {
      console.warn('[TripMemo] 抽屉：找不到这个地点（' + placeId + '）');
      return false;
    }

    currentId = placeId;
    /* ⭐ Day 21：照片功能上线了 —— 每次打开回到「照片」。
       （原来这里刻意停在「故事」，是因为照片那页还是占位说明。） */
    activeTab = 'photo';
    lastFocused = document.activeElement;

    renderHero(place);
    renderStats(place);
    renderTabs();
    renderBody();

    el.root.removeAttribute('hidden');
    /* 焦点移进来，键盘用户才接得上（否则 Tab 还在背后的列表里） */
    if (el.close) {
      el.close.focus();
    }
    return true;
  }

  function close() {
    if (!el.root) {
      return;
    }
    el.root.setAttribute('hidden', '');
    currentId = null;
    if (lastFocused && lastFocused.focus) {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function isOpen() {
    return !!el.root && !el.root.hasAttribute('hidden');
  }

  /* ------------------------------------------------------------
     四、初始化
     ------------------------------------------------------------ */
  function cacheDom() {
    el.root   = document.getElementById('drawer-place');
    el.scrim  = document.getElementById('drawer-scrim');
    el.close  = document.getElementById('drawer-close');
    /* ⭐ 顶部那块（放照片背景的地方，Day 21） */
    el.hero   = document.querySelector('.drawer-hero');
    el.kicker = document.getElementById('drawer-kicker');
    el.title  = document.getElementById('drawer-title');
    el.sub    = document.getElementById('drawer-sub');
    el.stats  = document.getElementById('drawer-stats');
    el.tabs   = document.getElementById('drawer-tabs');
    el.body   = document.getElementById('drawer-body');
    el.edit   = document.getElementById('drawer-edit');
  }

  function init() {
    cacheDom();
    if (!el.root) {
      console.warn('[TripMemo] 没找到抽屉容器，地点列表的点击会退回原来的弹窗');
      return;
    }

    /* 左边那条暗底就是遮罩，点它关掉 */
    el.scrim.addEventListener('click', close);
    el.close.addEventListener('click', close);

    /* 「编辑这个地点」→ **先关抽屉、再开原来的三态弹窗**。
       ⚠️ 顺序不能反：两者 z-index 都是 100，同时开着会叠在一起。 */
    el.edit.addEventListener('click', function () {
      var id = currentId;
      close();
      if (id && global.TripMemoDetail) {
        global.TripMemoDetail.openView(id);
      }
    });

    /* Esc 关掉（和原弹窗的行为保持一致） */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        close();
      }
    });
  }

  global.TripMemoDrawer = { init: init, open: open, close: close, isOpen: isOpen };

}(window));

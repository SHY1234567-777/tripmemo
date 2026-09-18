/* ============================================================
   TripMemo 入口脚本
   Day 7 · 步骤 2a：页面骨架 —— 导航栏与视图切换

   本步骤只负责「界面能切换」。
   地图（高德）在 2b 接入，数据读写与其余视图在 2b / 2c 接入。
   ============================================================ */

(function () {
  'use strict';

  /* 视图名 → 容器 id 的对应关系 */
  var VIEW_IDS = {
    map: 'view-map',
    timeline: 'view-timeline',
    places: 'view-places'
  };

  /* 默认首屏：地图视图（PRD 5.1） */
  var DEFAULT_VIEW = 'map';

  /* 当前正在显示的视图名 */
  var currentView = DEFAULT_VIEW;

  /**
   * 切换视图
   * @param {string} name 视图名（map / timeline / places）
   */
  function switchView(name) {
    if (!VIEW_IDS[name]) {
      return;
    }
    currentView = name;

    // 1、视图容器：只让目标视图显示
    Object.keys(VIEW_IDS).forEach(function (key) {
      var el = document.getElementById(VIEW_IDS[key]);
      if (el) {
        el.classList.toggle('is-active', key === name);
      }
    });

    // 2、导航按钮：同步高亮状态
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.view === name);
    });

    // 3、广播事件：2b 接入地图后，需要知道「自己被显示了」才能正确计算尺寸
    document.dispatchEvent(new CustomEvent('view:change', {
      detail: { view: name }
    }));
  }

  /**
   * 「导出 JSON」按钮
   * 数据层提供导出能力，这里只负责接线（PRD 4.1 #7）
   */
  function handleExportClick() {
    var Store = window.TripMemoStore;
    if (!Store) {
      window.alert('数据层尚未就绪，暂时无法导出。');
      return;
    }
    var count = Store.listPlaces().length;
    if (count === 0) {
      window.alert('现在还没有任何地点，导出的文件会是空的。');
      return;
    }
    Store.downloadJSON();
    console.log('[TripMemo] 已导出 ' + count + ' 个地点');
  }

  /** 页面初始化 */
  function init() {
    // 导航按钮 → 切换视图
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.dataset.view);
      });
    });

    // 导出按钮
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', handleExportClick);
    }

    // 显示默认视图
    switchView(DEFAULT_VIEW);

    // 初始化地点详情弹窗（三态）
    if (window.TripMemoDetail) {
      window.TripMemoDetail.init();
    }

    // 初始化地图视图（内部会自己去加载高德 SDK）
    if (window.TripMemoMap) {
      window.TripMemoMap.init();
    }

    // 初始化另外两个视图
    if (window.TripMemoTimeline) {
      window.TripMemoTimeline.init();
    }
    if (window.TripMemoPlaces) {
      window.TripMemoPlaces.init();
    }

    console.log('[TripMemo] 骨架已就绪，当前视图：' + currentView);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

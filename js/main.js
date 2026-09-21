/* ============================================================
   TripMemo 入口脚本
   Day 7 · 步骤 2a：页面骨架 —— 导航栏与视图切换
   Day 8 · 板块③：接上「示例数据」按钮与全局错误提示

   本文件只负责「装配」：把按钮、视图、数据层接起来，不写业务逻辑。
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

  /* 示例数据按钮的两个文案 */
  var SAMPLE_LABEL_LOAD = '载入示例数据';
  var SAMPLE_LABEL_CLEAR = '清空示例数据';

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

  /* ------------------------------------------------------------
     示例数据按钮（Day 8）

     一个按钮两种作用，靠数据层记录的 sampleLoaded 判断该做哪个。
     为什么要弹确认框：载入会"换掉"当前数据，虽然是可还原的，
                      但用户必须知道发生了什么，不能默默替换。
     ------------------------------------------------------------ */

  /** 按当前状态刷新按钮文案 */
  function refreshSampleLabel() {
    var label = document.getElementById('btn-sample-label');
    var Store = window.TripMemoStore;
    if (!label || !Store || !Store.isSampleLoaded) {
      return;
    }
    label.textContent = Store.isSampleLoaded() ? SAMPLE_LABEL_CLEAR : SAMPLE_LABEL_LOAD;
  }

  /** 点示例数据按钮 */
  function handleSampleClick() {
    var Store = window.TripMemoStore;
    if (!Store || !Store.loadSampleData) {
      window.alert('数据层尚未就绪，暂时无法操作示例数据。');
      return;
    }

    if (Store.isSampleLoaded()) {
      /* 当前是示例模式 → 清空并还原 */
      var okClear = window.confirm(
        '将清空示例数据，恢复你载入示例前原有的数据。\n\n继续吗？'
      );
      if (!okClear) {
        return;
      }
      var cleared = Store.clearSampleData();
      if (cleared.ok) {
        refreshSampleLabel();
        window.alert('已清空示例数据，恢复原有数据（' + cleared.count + ' 个地点）。');
      }
      return;
    }

    /* 当前是正常模式 → 载入示例 */
    var okLoad = window.confirm(
      '载入示例数据会把当前的地点替换成 13 条示例地点。\n\n'
      + '你现有的数据会先自动备份 —— 随时点「清空示例数据」就能还原。\n\n继续吗？'
    );
    if (!okLoad) {
      return;
    }
    var result = Store.loadSampleData();
    if (result.ok) {
      refreshSampleLabel();
      window.alert('已载入 ' + result.count + ' 条示例地点。\n'
        + '可以去「时间轴」「地点列表」看看效果。');
    } else {
      window.alert('载入失败：' + result.reason);
    }
  }

  /* ------------------------------------------------------------
     全局错误提示（Day 8）

     为什么需要：数据层出错原来只写 console.error，用户看到的是一片空白，
                完全不知道发生了什么 —— 这就是"错误状态最容易被忽略"
                在真实项目里的样子。
     ------------------------------------------------------------ */

  /** 把错误显示成页面顶部的一条提示 */
  function showStoreError(detail) {
    var bar = document.getElementById('app-alert');
    if (!bar) {
      return;
    }
    var info = detail || {};
    bar.textContent = '数据出错了（' + (info.scope || '未知环节') + '）：'
      + (info.message || '原因不明') + '　—— 你的改动可能没有被保存。';
    bar.removeAttribute('hidden');
  }

  /**
   * 补一次"开局检查"
   * 因为 store:error 的监听是在 init 里才装的，
   * 万一错误发生得更早，事件已经过去了 —— 这里把记下来的错误补显示一次。
   */
  function initGlobalErrorWatch() {
    var Store = window.TripMemoStore;
    if (Store && Store.getLastError) {
      var err = Store.getLastError();
      if (err) {
        showStoreError(err);
      }
    }
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

    /* ---- 示例数据按钮（Day 8）----
       ⚠️ 错误提示的监听必须**尽早注册**：数据层出错时会广播
          `store:error`，如果监听装晚了，早期错误就漏掉了。
          所以这里紧跟导出按钮，先于各视图的初始化。 */
    var sampleBtn = document.getElementById('btn-sample');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', handleSampleClick);
    }
    document.addEventListener('store:error', showStoreError);
    initGlobalErrorWatch();

    // 显示默认视图
    switchView(DEFAULT_VIEW);

    // 初始化地点详情弹窗（三态）
    if (window.TripMemoDetail) {
      window.TripMemoDetail.init();
    }

    // 初始化地点详情抽屉（只读 · Day 10 新增）
    // ⚠️ 必须排在地点列表之前 —— 列表里点条目要用到它
    if (window.TripMemoDrawer) {
      window.TripMemoDrawer.init();
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

    // 按钮文案要和当前状态一致（刷新后不能显示错的那个词）
    refreshSampleLabel();

    console.log('[TripMemo] 骨架已就绪，当前视图：' + currentView);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

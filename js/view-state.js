/* ============================================================
   ViewState —— 「空 / 加载 / 错误 / 正常」四种状态的**唯一收尾处**（Day 13）

   ⭐ 为什么单独一个模块：
      时间轴和地点列表**要一模一样的四态逻辑**。各写一份就是"同一个逻辑两种写法"，
      改的时候必然漏一个（原则 2）—— 而这种错**不报错**，
      只在某个视图上表现不对，事后很难查。
      （同一天刚好有一处真实教训：`map.js` 里重复实现了 `Model.typeLabel`。）

   ⭐ 它管什么：
      · 四态**互斥**地显示 —— 收在一处，防"两个状态同时露出来"
      · 「加载态至少显示 UI_MIN_LOADING_MS」—— 防闪烁，不是故意拖慢
      · 读失败 → 错误态（**绝不显示成"空"** —— 那是把用户往错的方向引）
   ⭐ 它不管什么：
      · 不管"正常 / 空"长什么样 —— 那是各视图自己的事（由传进来的 paint 负责）
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;

  /**
   * 给一个"列表型视图"装上四种状态
   *
   * @param {{list: HTMLElement, empty: HTMLElement, loading: HTMLElement,
   *          error: HTMLElement, errorMsg: HTMLElement}} el
   *        ⚠️ 缺哪个就自动跳过哪个（不抛错）——
   *           某个视图少一块元素时，不该让整个视图挂掉。
   * @returns {{showState: function, renderWithStates: function}}
   */
  function attach(el) {
    el = el || {};

    /**
     * 四种状态**互斥**地显示
     * ⚠️ 收在一处的原因：如果各处自己写 `xxx.hidden = true/false`，
     *    很容易出现"两个状态同时露出来"（比如加载中和空状态叠在一起）——
     *    那种 bug 特别难看，而且很难一眼找到写错的那一行。
     * @param {string} which 'loading' | 'error' | 'empty' | 'ok'
     */
    function showState(which) {
      if (el.loading) { el.loading.hidden = (which !== 'loading'); }
      if (el.error) { el.error.hidden = (which !== 'error'); }
      if (el.empty) { el.empty.hidden = (which !== 'empty'); }
      if (el.list) { el.list.hidden = (which !== 'ok'); }
    }

    /**
     * 取数据 → 按结果进状态 → 「正常 / 空」交给 paint 自己决定
     *
     * @param {function(Object, function)} paint
     *        `paint(result, showState)` —— **只在读成功时**被调用；
     *        视图自己在里面调 `showState('empty')` 或 `showState('ok')`。
     */
    function renderWithStates(paint) {
      showState('loading');

      var startedAt = Date.now();

      /* ① 取数据。
         ⚠️ 现在数据是同步的（localStorage），这里故意**推后一拍**：
            ① 让「加载中」成为一个**真实存在过的状态**，
               上层不用为"同步还是异步"写两套逻辑；
            ② ⭐ **将来接云数据，只要把这一处换成网络请求，上面的逻辑一行都不用改。** */
      setTimeout(function () {
        var result = global.TripMemoStore.readPlacesResult();

        /* ② 加载态**至少显示 Model.UI_MIN_LOADING_MS**：
              本地读数据只要几毫秒，不这么做它会"一闪而过" ——
              视觉上是一次抖动，比不显示还糟。（不是故意拖慢，是防闪烁。） */
        var rest = Model.UI_MIN_LOADING_MS - (Date.now() - startedAt);
        setTimeout(function () {
          /* ③ 读失败 → 错误态。
                ⚠️ 绝不能落到"空"态 —— 那会把"环境出问题"伪装成"你还没记东西"，
                   把用户往错的方向引。 */
          if (!result.ok) {
            if (el.errorMsg) {
              el.errorMsg.textContent = result.reason || '未知原因';
            }
            showState('error');
            return;
          }
          paint(result, showState);
        }, rest > 0 ? rest : 0);
      }, 0);
    }

    return { showState: showState, renderWithStates: renderWithStates };
  }

  global.TripMemoViewState = { attach: attach };

}(window));

/* ================================================================================
   门面页 · 方案 C「摊牌扇开」的交互（2026-10-09）
   --------------------------------------------------------------------------------
   叠着 → 点一下 → 五张卡绕底边转开成扇子；再点"收拢"或点别处 → 收回。
   ⚠️ 与 `js/main.js` **完全独立**：这里不碰 app 的任何状态，只负责这一叠卡的开合。
   ⚠️ 「开始记录」的跳转**不在这里** —— 它由 `main.js` 通过 `id="landing-enter"` 绑定
      （按钮上保留这个 id，功能就与旧门面页完全一致）。
   ================================================================================ */
(function () {
  'use strict';

  var cDeck = document.getElementById('c-deck');
    var cFan = document.getElementById('c-fan');
    var cFanhint = document.getElementById('c-fanhint');
    var cFanfold = document.getElementById('c-fanfold');

    function cSetOpen(open) {
      if (!cDeck) return;
      cDeck.classList.toggle('is-open', open);
      cDeck.classList.toggle('is-stacked', !open);
      if (cFan) cFan.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (cFan) {
      /* 点"提示"就展开 */
      if (cFanhint) cFanhint.addEventListener('click', function (e) {
        e.stopPropagation();
        cSetOpen(true);
        var first = cDeck.querySelector('.c-frame[role="button"]');
        if (first) first.focus();
      });
      /* 点"牌堆"本身：叠着就展开；已扇开且点的是空白就收拢 */
      cFan.addEventListener('click', function (e) {
        if (e.target.closest('.c-fanfold')) return;
        if (e.target.closest('.c-frame[role="button"]')) return;   // 点单张卡不切换
        cSetOpen(!cDeck.classList.contains('is-open'));
      });
      /* 键盘：Enter / Space 开合 */
      cFan.addEventListener('keydown', function (e) {
        if (e.target !== cFan) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        cSetOpen(!cDeck.classList.contains('is-open'));
      });
      /* 收拢按钮 */
      if (cFanfold) cFanfold.addEventListener('click', function (e) {
        e.stopPropagation();
        cSetOpen(false);
        cFan.focus();
      });
      /* 每张卡：键盘 Enter 也能"翻开"（演示页里等价于展开整叠） */
      Array.prototype.forEach.call(cDeck.querySelectorAll('.c-frame[role="button"]'), function (card) {
        card.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          cSetOpen(true);
        });
        card.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!cDeck.classList.contains('is-open')) cSetOpen(true);
        });
      });
    }

    /* 文档其它地方点一下 → 把摊开的牌收拢（点牌堆内部不触发） */
    document.addEventListener('click', function (e) {
      if (!cDeck || !cDeck.classList.contains('is-open')) return;
      if (cDeck.contains(e.target)) return;
      cSetOpen(false);
    });
})();

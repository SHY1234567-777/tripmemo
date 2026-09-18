/* ============================================================
   TripMemo 本地配置 —— 模板文件
   （本文件会被提交到 GitHub，里面只有占位符，没有真实密钥）

   怎么用：
   1. 把本文件复制一份，命名为 config.js
   2. 打开 config.js，把下面两串值换成你自己的
   3. config.js 已被 .gitignore 挡住，不会上传到 GitHub

   两串值去哪拿：
   https://lbs.amap.com → 控制台 → 应用管理 → 我的应用 → 添加 Key
   服务平台必须选「Web端（JS API）」
   ============================================================ */

window.TRIPMEMO_CONFIG = {

  /* 高德地图 Key */
  amapKey: '在这里填入你的 Key',

  /* 高德安全密钥（JS API 2.0 必须，英文名 securityJsCode）
     只填 Key 不填它会加载失败 */
  amapSecurityCode: '在这里填入你的安全密钥'
};

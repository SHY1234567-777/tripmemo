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
  amapSecurityCode: '在这里填入你的安全密钥',

  /* 地图底图样式（可选）
     ─────────────────────────────────────────────────────
     留空 或 删掉这一行 → 自动用代码里的默认样式
                          （amap://styles/fresh 草色青）
                          ⚠️ 默认值写在 js/map.js 的 DEFAULT_MAP_STYLE，不在这里

     想自定义配色：
       1. 打开 https://console.amap.com/dev/mapstyle/index
       2. 新建一个地图样式，按需调整底图颜色
       3. 保存后复制「样式ID」（一串字母数字）
       4. 把下面的值改成 'amap://styles/你的样式ID'

     也可以直接用官方内置的样式（完整 11 种）：
       标准      amap://styles/normal
       幻影黑    amap://styles/dark
       月光银    amap://styles/light
       远山黛    amap://styles/whitesmoke
       草色青    amap://styles/fresh        ← 目前默认用这个（浅绿米底）
       雅士灰    amap://styles/grey
       涂鸦      amap://styles/graffiti
       马卡龙    amap://styles/macaron
       靛青蓝    amap://styles/blue
       极夜蓝    amap://styles/darkblue
       酱籽      amap://styles/wine

     ⚠️ 注意：官方只提供"整体换样式"，【不能】只改其中某一种元素
        （比如只改边界线颜色）—— 实测过第三方博客的 styles 数组
        写法，无效。想精细控制只能去控制台做自定义样式。 */
  mapStyle: ''   /* 例如 'amap://styles/wine' 或 'amap://styles/你的样式ID' */
};

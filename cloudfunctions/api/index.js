const http = require('http');
const cloudbase = require('@cloudbase/node-sdk');

/* ------------------------------------------------------------
   ⭐ 数据库连接（Day 17 加）
   ------------------------------------------------------------
   ⚠️ 为什么是 `@cloudbase/node-sdk` 而不是别的：
      它是 CloudBase 官方的服务端 SDK，**在云函数里用它不需要配任何密钥**
      （官方原文：「在 CloudBase 云函数内使用服务端 SDK 时，开发者不需要填入腾讯云密钥」）——
      平台会自动注入鉴权信息。

   ⭐ 为什么云函数能读到权限为 PRIVATE 的集合（官方原文）：
      「**服务端上，是以管理员身份调用云数据库的，拥有读取、写入、修改、删除任意数据的权限。
        所以服务端又称管理端。**」
      → 前端直连读不到别人的数据，但云函数能读全部 —— 这正是我们要的效果。

   ⚠️ `env` 显式传而不是让 SDK 自己猜：
      官方示例在"普通云函数"里可以 `init({})`（环境变量自动注入），
      但我们是 **HTTP 云函数**，形态不同，**显式传更稳**。
      ⚠️ 环境 ID 不是密钥（它是半公开的，前端代码里本来就会出现）。 */
const ENV_ID = 'tripmemo-d3gd23bd14a396d1d';
const app = cloudbase.init({ env: ENV_ID });
const db = app.database();

/* ------------------------------------------------------------
   ⚠️ 临时的"当前用户"（Day 17）
   ------------------------------------------------------------
   ⚠️ 现在还没有登录系统（Day 20 才做），但接口必须有"这是谁的数据"这个概念 ——
      ⭐ 所以先写死一个种子数据里存在的用户，**Day 20 接认证后这里的值改成从登录态取**。
   ⭐ 这么做还有个好处：**能顺便验证"按用户筛选"这个逻辑是通的**
      （/api/places 只会返回这个用户的地点，不是全部）。 */
const CURRENT_USER_ID = 'u_shy';

/**
 * ⭐ 把数据库里的一条 place 文档，转成接口对外返回的形状
 *
 * ⚠️ 为什么要有这一步（不能直接把 doc 返回出去）：
 *   1. ⭐ **`_id` 要改成 `id`** —— 契约 §3.4 定死的：数据库内部叫 `_id`，
 *      接口层一律叫 `id`。⚠️ 漏了这一步，前端拿到的就是 `undefined`。
 *   2. ⭐ **时间字段要转成 ISO 字符串** —— 数据库里是 ISODate 对象，
 *      直接 JSON 序列化会变成一个前端看不懂的结构。
 *   3. ⚠️ **不直接透传** —— 数据库里可能有内部字段，显式列出来才不会漏出去。
 *
 * @param {object} doc 数据库文档
 * @returns {object} 契约 §1.2 定义的 place 形状
 */
function toApiPlace(doc) {
  return {
    id: doc._id,
    ownerId: doc.ownerId || '',
    name: doc.name || '',
    city: doc.city || '',
    lng: doc.lng,
    lat: doc.lat,
    type: doc.type || '',
    startMonth: doc.startMonth || '',
    endMonth: doc.endMonth || '',
    note: doc.note || '',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    images: Array.isArray(doc.images) ? doc.images : [],
    createdAt: toIsoString(doc.createdAt),
  };
}

/**
 * 把数据库的日期转成 ISO 字符串（前端认这个格式）
 * ⚠️ 兼容三种可能：Date 对象 / 字符串 / 空
 */
function toIsoString(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * 统一的成功响应 —— 契约 §3.1 定的形状是 { ok: true, ...数据 }
 */
function sendOk(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(Object.assign({ ok: true }, payload)));
}

/**
 * 统一的错误响应 —— 契约 §3.1 定的形状是 { ok: false, error: { code, message } }
 */
function sendError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: { code: code, message: String(message) } }));
}

/**
 * TripMemo API 服务
 * ⚠️⚠️ 这是 **HTTP 云函数**，不是普通云函数 —— 两者形态完全不同：
 *
 *   |            | 普通云函数                        | HTTP 云函数（本文件）        |
 *   |------------|-----------------------------------|------------------------------|
 *   | 代码       | exports.main = async (event, ctx) | http.createServer + listen   |
 *   | 入参       | 平台包装好的 event（集成请求结构）| 标准 req / res               |
 *   | 启动       | 平台自动                          | 靠 scf_bootstrap 启动        |
 *   | 路由       | 平台按路径转发                    | 自己在函数里判断 req.url     |
 *
 * ⭐ 为什么选 HTTP 云函数：一个文件就能写多条路由，
 *    Day 16–20 要加五六个真接口时不用建一堆函数。
 * ⚠️ 代价：HTTP 函数**不会自动安装依赖**（node_modules 要自己带），
 *    所以这里**只用 Node 原生模块**，零依赖。
 *
 * ⚠️ 部署方式：**这个文件的内容要复制到 CloudBase 控制台的 `index.js` 里**
 *    （或者用 CloudBase CLI 部署 —— 见同目录 README.md）
 */

// ⚠️ 回调必须是 async —— 里面有 await 查数据库（Day 17 改的）
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const path = url.pathname;

  /* ⭐ GET /api/health —— 健康检查
     职责只有一个：证明「云函数 + 公网访问」这条链路是通的。
     ⚠️ 不连数据库、不写业务逻辑。

     ⚠️ 三个路径都放行，因为不确定平台转发过来时 URL 长什么样：
        · 开了「路径透传」→ 收到的是原始的 /api/health
        · 没开 → 可能被剥成 /
       先都兼容，稳一点。 */
  const isHealth = (path === '/api/health' || path === '/health' || path === '/');

  if (isHealth && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'TripMemo' }));
    return;
  }

  /* ⭐ GET /api/db-check —— 数据库连通性检查（Day 17 第 0 步）

     ⭐ 它的唯一目的：**在写正式读接口之前，先证明云函数真能读到数据库。**

     ⚠️ 为什么不直接写 /api/places？因为那样一旦失败，你分不清是
        · 接口代码写错了
        · 还是连不上数据库（权限 / 环境 ID / SDK 没装）
     ⭐ 先用一个"只数条数"的接口把"能不能连"这件事单独验掉 ——
        这就是「先打通、再加载」。

     ⚠️ 它会把**错误的原文**返回出来（而不是笼统地说"失败了"）——
        因为这一步唯一的价值就是看清楚错误信息。
     ⭐ 验证通过后，这个接口可以留着（当健康检查用），也可以删。 */
  if (path === '/api/db-check' && req.method === 'GET') {
    try {
      const placesRes = await db.collection('places').get();
      const usersRes = await db.collection('users').get();
      const settingsRes = await db.collection('settings').get();
      const list = placesRes.data || [];

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          placesCount: list.length,
          usersCount: (usersRes.data || []).length,
          settingsCount: (settingsRes.data || []).length,
          firstPlaceName: list[0] ? list[0].name : null,
        },
      }));
      return;
    } catch (err) {
      /* ⚠️ 把错误原文吐出来 —— 这是本接口存在的意义 */
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: false,
        error: {
          code: 'DB_CHECK_FAILED',
          message: String((err && err.message) || err),
          name: String((err && err.name) || ''),
        },
      }));
      return;
    }
  }

  /* ------------------------------------------------------------
     ⭐ GET /api/places —— 列表读取（契约 §四.1，本项目最重要的读接口）
     ------------------------------------------------------------
     ⭐ 地图、时间轴、地点列表三个页面全靠它。
     ⭐ 按契约：响应形状是 { ok: true, places: [...] }（不是通用的 {ok,data}）——
        因为前端的 store.readPlacesResult() 返回的就是 {ok, places}，
        ⭐ 沿用这个形状，Day 18 改前端时改动最小。

     ⚠️ 只返回 CURRENT_USER_ID 自己的地点（"按用户筛选"） */
  if (path === '/api/places' && req.method === 'GET') {
    try {
      const where = { ownerId: CURRENT_USER_ID };

      /* ⭐ 可选的 type 筛选（契约 §四.1 定义的行为）：
         · 不传 / 传空串 → 返回全部
         · 传了 4 个合法值之外 → ⚠️ 返回 400，**不是**静默返回空数组
           （静默会让前端把"打错字"当成"没有数据"） */
      const VALID_TYPES = ['long', 'short', 'travel', 'wishlist'];
      const typeParam = url.searchParams.get('type');
      if (typeParam !== null && typeParam !== '') {
        if (VALID_TYPES.indexOf(typeParam) === -1) {
          sendError(res, 400, 'INVALID_INPUT',
            'type 只能是 ' + VALID_TYPES.join(' / ') + '，收到的是：' + typeParam);
          return;
        }
        where.type = typeParam;
      }

      /* ⭐ 可选的 limit（Day 17 余力加练）：限制返回条数。
         ⚠️ 为什么值得加这一个参数：
            · 数据一多，一次全拉回来又慢又费流量；
            · ⭐ 它和 skip 搭配就是"分页"的基础；
            · ⚠️ 更重要的是**安全**：不设上限的话，有人请求
              `?limit=999999` 就能把服务器和流量拖垮 —— 所以必须卡一个最大值。 */
      const MAX_LIMIT = 100;
      const limitParam = url.searchParams.get('limit');
      let limit = 0;   /* 0 = 不限制（沿用契约原本的行为） */
      if (limitParam !== null && limitParam !== '') {
        limit = Number(limitParam);
        /* ⚠️ 用 Number.isInteger 而不是 isNaN：
           否则 `2.5` / `-1` / `Infinity` 都会被放过去 */
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
          sendError(res, 400, 'INVALID_INPUT',
            'limit 必须是 1~' + MAX_LIMIT + ' 之间的整数，收到的是：' + limitParam);
          return;
        }
      }

      const query = db.collection('places').where(where);
      const result = limit > 0
        ? await query.limit(limit).get()
        : await query.get();

      const places = (result.data || []).map(toApiPlace);

      sendOk(res, { places: places });
      return;
    } catch (err) {
      console.error('[TripMemo] GET /api/places 失败：', err);
      sendError(res, 500, 'SERVER_ERROR', (err && err.message) || err);
      return;
    }
  }

  /* ------------------------------------------------------------
     ⭐ GET /api/place?id=xxx —— 读单个地点（契约 §四.2）
     ------------------------------------------------------------
     ⚠️⚠️ 为什么写成 /api/place?id=xxx，而不是 /api/places/:id：
        ⭐ CloudBase 的路由路径**只能包含字母、数字、下划线和连接符** ——
        ⚠️ **冒号 `:` 不被允许**，所以 `/api/places/:id` 这种"动态路径"
        **在「HTTP 访问」里根本配不了路由**（Day 17 实测：填了保存不了）。
     ⭐ 所以本项目**所有带参数的接口，一律改用查询参数**（`?id=` / `?limit=` 都是这个套路）。
     ⚠️ 连带影响：契约里原本写的 PUT /api/places/:id、DELETE /api/places/:id
        也都要改成查询参数形式（Day 18 写的时候一并改）。
     ⚠️ 注意路径是 **place（单数）**，和列表的 /api/places（复数）区分开。 */
  if (path === '/api/place' && req.method === 'GET') {
    try {
      const id = url.searchParams.get('id');
      if (!id) {
        sendError(res, 400, 'INVALID_INPUT', '缺少 id 参数。用法：/api/place?id=xxx');
        return;
      }

      /* ⚠️ `_id` 是数据库里的主键名（这里查库要用它），
         而对外返回的字段叫 `id` —— 由 toApiPlace() 负责映射。 */
      const result = await db.collection('places')
        .where({ _id: id, ownerId: CURRENT_USER_ID })
        .get();
      const doc = (result.data || [])[0];

      if (!doc) {
        /* ⚠️ "不存在"和"存在但不属于你"**都返回 404** —— 契约 §四.2 特意定的：
           如果后者返回 403，就等于告诉别人"这条数据存在，只是不是你的"。 */
        sendError(res, 404, 'NOT_FOUND', '找不到这个地点，或它不属于当前用户');
        return;
      }

      sendOk(res, { place: toApiPlace(doc) });
      return;
    } catch (err) {
      console.error('[TripMemo] GET /api/place 失败：', err);
      sendError(res, 500, 'SERVER_ERROR', (err && err.message) || err);
      return;
    }
  }

  /* ------------------------------------------------------------
     ⭐ GET /api/meta —— 读设置（契约 §四.6）
     ------------------------------------------------------------
     ⚠️ 契约特意写了：mainCity 允许是 null（用户还没设定主城市）——
        前端要能处理这种情况（地图上就没有连线起点）。 */
  if (path === '/api/meta' && req.method === 'GET') {
    try {
      const result = await db.collection('settings')
        .where({ ownerId: CURRENT_USER_ID })
        .get();
      const doc = (result.data || [])[0] || null;

      sendOk(res, {
        mainCity: doc && doc.mainCity ? doc.mainCity : null,
        sampleLoaded: doc ? !!doc.sampleLoaded : false,
      });
      return;
    } catch (err) {
      console.error('[TripMemo] GET /api/meta 失败：', err);
      sendError(res, 500, 'SERVER_ERROR', (err && err.message) || err);
      return;
    }
  }

  /* ⚠️ 路径对但方法不对 → 明确拒绝（别让它变成"万能入口"）
     ⚠️ 注意这里**必须走 sendError()**，不能手写 JSON ——
     契约 §3.1 定的错误形状是 `{ok:false, error:{code, message}}`（**error 是对象**），
     ⚠️ 手写很容易写成 `error: '字符串'`，就破坏了契约（Day 17 就犯过这个）。 */
  if (isHealth) {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '健康检查只接受 GET 请求');
    return;
  }

  /* 其余路径 → 404。
     ⚠️ 这里是**兜底**：所有没被上面任何分支命中的请求都会落到这儿。
     ⭐ 所以 Day 18–20 写的新接口，**必须加在这一段之前** —— 加在后面永远不会被命中。 */
  sendError(res, 404, 'NOT_FOUND', '没有这个接口');
});

// ⚠️ 端口必须是 9000 —— CloudBase 的 HTTP 函数固定监听这个端口（创建时不可改）
server.listen(9000);

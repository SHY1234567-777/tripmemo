const http = require('http');

/* ============================================================
   ⭐⭐ 分层说明（Day 19 重构）
   ============================================================
   这个文件现在是**接口层** —— 只管：**接请求 → 调函数 → 返响应**。
   ⚠️ 它**已经看不到数据库细节**了（没有 `db.collection(...)`、没有集合名）。

   | 层 | 文件 | 只负责 |
   |---|---|---|
   | ⭐ **接口层** | `index.js`（本文件） | HTTP：路径/方法判断、参数校验、状态码、JSON 响应 |
   | ⭐ **数据访问层** | `repositories/*.js` | 查什么、怎么查、把数据库文档转成接口形状 |
   | ⭐ **连接层** | `cloudbase.js` | 连上数据库（环境 ID 只在那里出现） |

   ⭐ 「Day 19 要掌握」的答案：
      **"查数据库"那段代码，从下面这些路由分支里，搬到了 `repositories/placesRepository.js`。**
   ============================================================ */

const cloudbaseModule = require('./cloudbase.js');
const placesRepo = require('./repositories/placesRepository.js');
const settingsRepo = require('./repositories/settingsRepository.js');
const usersRepo = require('./repositories/usersRepository.js');

/* ⭐ 从数据层引过来用（保证"4 种类型"只有一处定义） */
/* ⭐ 环境 ID —— ⚠️ 它住在 cloudbase.js 里（Day 19 重构时挪过去的），
   这里必须**显式引过来**。⭐ Day 20 就因为这个漏引，导致云函数一跑就
   `ReferenceError: ENV_ID is not defined` → 进程退出 → 网关返回 439。 */
const ENV_ID = cloudbaseModule.ENV_ID;

const VALID_PLACE_TYPES = placesRepo.VALID_PLACE_TYPES;
/* ⭐ 转接口形状这一步属于数据层，但 POST 组装文档时要用一下 */
const toApiPlace = placesRepo.toApiPlace;

/* ------------------------------------------------------------
   ⭐⭐ 身份解析（Day 20 实装）
   ------------------------------------------------------------
   ⚠️ 之前这里是写死的 `CURRENT_USER_ID = 'u_shy'` ——
      所以**谁打开都看到同一份数据**。
   ⭐ 现在改成：**每个请求先从请求头里解出"你是谁"**。

   ⭐ 流程：
      ① 前端匿名登录 → 拿到 access_token
      ② 每个请求带 `Authorization: Bearer {token}`
      ③ ⭐ 云函数把 token 转给平台问"这人是谁"（`/auth/v1/user/me`）
      ④ 拿到 uid → 拿它当 ownerId 做筛选

   ⚠️ 兜底：**没带 token / 验证失败** 时用 FALLBACK_USER_ID ——
      这样"没登录也能看到数据"，不至于页面直接空白。
      ⭐ 但注意这**只是过渡措施**：理论上应该改成直接返回 401（记在待办里）。
   ------------------------------------------------------------ */
const FALLBACK_USER_ID = 'u_shy';

/**
 * ⭐ 从请求头里取出 access token（去掉 `Bearer ` 前缀）
 * ⚠️ 官方原话："通过获取请求 Header 中 Authorization 字段获取到请求 Token，
 *    注意去除 Bearer 字段"
 */
function getBearerToken(req) {
  var h = req.headers['authorization'] || req.headers['Authorization'];
  if (!h) return null;
  var m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1] : null;
}

/**
 * ⭐ 拿 token 去问平台"这是谁"
 *
 * ⭐ 为什么把验证交给平台、而不是自己解 JWT：
 *    自己解 = 不验签名 = ⚠️ **前端随便编一个就能冒充别人**。
 *    官方有现成的接口，验证由平台做，伪造的 token 会被拒。
 *
 * @returns {Promise<{ok:boolean, uid?:string, reason?:string, raw?:object}>}
 */
async function resolveUserId(req) {
  const token = getBearerToken(req);
  if (!token) return { ok: false, reason: 'no_token' };

  const url = 'https://' + ENV_ID + '.api.tcloudbasegateway.com/auth/v1/user/me';
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const json = await res.json().catch(function () { return null; });

    if (!res.ok) {
      return { ok: false, reason: 'http_' + res.status, raw: json };
    }

    /* ⚠️ 用户 id 到底在哪个字段里（`user_id` / `sub` / 嵌套在 `data` 里）——
       官方不同版本的文档给的示例不完全一致，所以这里**按顺序都试一遍**。
       ⭐ 到底命中哪个，用下面的 /api/whoami 实测一次就知道了。 */
    const d = (json && json.data) ? json.data : json;
    const uid = (d && (d.user_id || d.sub || d.uid)) || null;

    if (!uid) return { ok: false, reason: 'no_uid_field', raw: json };
    return { ok: true, uid: String(uid), raw: json };
  } catch (err) {
    return { ok: false, reason: 'fetch_failed: ' + ((err && err.message) || err) };
  }
}


/**
 * 统一的成功响应 —— 契约 §3.1 定的形状是 { ok: true, ...数据 }
 * ⚠️ status 可传，因为契约规定"新增用 201"而不是 200
 */
function sendOk(res, payload, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(Object.assign({ ok: true }, payload)));
}

/**
 * 统一的错误响应 —— 契约 §3.1 定的形状是 { ok: false, error: { code, message } }
 * ⚠️ 所有错误都必须走这里，不要手写 JSON（手写很容易把 error 写成字符串，破坏契约）
 */
function sendError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: { code: code, message: String(message) } }));
}

/**
 * ⭐ 校验一个"新增地点"的请求体（Day 18）
 *
 * @returns {object} 通过则返回 { ok:true, data:归一化后的字段 }；
 *                   不通过返回 { ok:false, message:中文提示 }
 *
 * ⚠️ 提示一律写成中文，而且**要说清缺了什么 / 哪一项不对** ——
 *    因为错误信息最终会显示给用户看，含糊的提示等于没有提示。
 */
function validateNewPlace(body) {
  const b = body || {};

  /* ---- 必填字符串 ---- */
  if (!b.name || String(b.name).trim() === '') {
    return { ok: false, message: '缺少必填字段：name（地点名称）' };
  }
  if (!b.city || String(b.city).trim() === '') {
    return { ok: false, message: '缺少必填字段：city（所属城市）' };
  }

  /* ---- 坐标：必须是数字，而且要在合法范围内 ---- */
  /* ⚠️ 用 Number() 而不是 parseFloat：parseFloat("12abc") 会得到 12，把错的当对的放过去 */
  const lng = Number(b.lng);
  const lat = Number(b.lat);
  if (b.lng === undefined || b.lng === null || b.lng === '' || !Number.isFinite(lng)) {
    return { ok: false, message: '缺少必填字段或格式不对：lng（经度）必须是数字' };
  }
  if (b.lat === undefined || b.lat === null || b.lat === '' || !Number.isFinite(lat)) {
    return { ok: false, message: '缺少必填字段或格式不对：lat（纬度）必须是数字' };
  }
  if (lng < -180 || lng > 180) {
    return { ok: false, message: 'lng（经度）超出合理范围，应为 -180 ~ 180，收到的是：' + b.lng };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, message: 'lat（纬度）超出合理范围，应为 -90 ~ 90，收到的是：' + b.lat };
  }

  /* ---- 类型：必须是那 4 个之一 ---- */
  if (!b.type || VALID_PLACE_TYPES.indexOf(b.type) === -1) {
    return { ok: false, message: 'type（地点类型）只能是 ' + VALID_PLACE_TYPES.join(' / ') + '，收到的是：' + b.type };
  }

  /* ---- 通过：把值归一化好再交给后面用 ---- */
  return {
    ok: true,
    data: {
      name: String(b.name).trim(),
      city: String(b.city).trim(),
      lng: lng,
      lat: lat,
      type: b.type,
      startMonth: b.startMonth ? String(b.startMonth) : '',
      endMonth: b.endMonth ? String(b.endMonth) : '',
      note: b.note ? String(b.note) : '',
      tags: Array.isArray(b.tags) ? b.tags : [],
      images: Array.isArray(b.images) ? b.images : [],
    },
  };
}

/**
 * ⭐ 读取并解析请求体（Day 18 加）
 *
 * ⚠️⚠️ 这里有个很容易踩的点：
 *    我们是 **HTTP 云函数**（`http.createServer`），所以请求体**不在 `event.body` 里**
 *    （那是**普通云函数**才有的事）—— 必须**自己从 `req` 这个流向里一段段读出来**。
 *
 * ⭐ 读完再 `JSON.parse`。解析失败就抛错，由调用方转成 400。
 */
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    req.on('data', function (chunk) { raw += chunk; });
    req.on('end', function () {
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('请求体不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
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

  /* ⭐⭐ 每个请求先解出"这是谁"（Day 20）
     ⚠️ 必须先于所有路由 —— 后面每个查询都要用它做筛选。
     ⭐ 解析失败不报错、用兜底用户，保证"至少能看到东西"（过渡措施，见上面的说明）。 */
  const who = await resolveUserId(req);
  if (!who.ok && who.reason !== 'no_token') {
    console.warn('[TripMemo] 身份解析失败（用兜底用户）：' + who.reason);
  }
  const userId = who.ok ? who.uid : FALLBACK_USER_ID;

  /* ⭐ 临时接口：把"云函数看到的身份"原样吐出来（Day 20 实测用）
     ⚠️ 它的唯一作用是**看清除 token 验证后到底返回了什么字段** ——
        确认之后就可以删掉它（或留着当排查工具）。
     ⚠️ 它不在契约里，不是正式接口。 */
  if (path === '/api/whoami' && req.method === 'GET') {
    sendOk(res, {
      hasToken: !!getBearerToken(req),
      tokenLength: (getBearerToken(req) || '').length,
      resolved: who.ok,
      userId: userId,
      usedFallback: !who.ok,
      reason: who.reason || null,
      freshPlaceCount: 0,
      upstreamRaw: who.raw || null,
    });
    return;
  }

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
      /* ⭐ 三个集合各数一次 —— 具体怎么数由 repository 负责，这里只拿结果 */
      const placesStat = await placesRepo.countAll();
      const usersCount = await usersRepo.countAll();
      const settingsCount = await settingsRepo.countAll();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          placesCount: placesStat.count,
          usersCount: usersCount,
          settingsCount: settingsCount,
          firstPlaceName: placesStat.first ? placesStat.first.name : null,
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

     ⚠️ 只返回 userId 自己的地点（"按用户筛选"） */
  if (path === '/api/places' && req.method === 'GET') {
    try {
      /* ⭐ 可选的 type 筛选（契约 §四.1 定义的行为）：
         · 不传 / 传空串 → 返回全部
         · 传了 4 个合法值之外 → ⚠️ 返回 400，**不是**静默返回空数组
           （静默会让前端把"打错字"当成"没有数据"） */
      const typeParam = url.searchParams.get('type');
      if (typeParam !== null && typeParam !== '') {
        if (VALID_PLACE_TYPES.indexOf(typeParam) === -1) {
          sendError(res, 400, 'INVALID_INPUT',
            'type 只能是 ' + VALID_PLACE_TYPES.join(' / ') + '，收到的是：' + typeParam);
          return;
        }
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

      /* ⭐ 校验通过后，把条件交给数据层 —— 这里不再出现 db.collection */
      const places = await placesRepo.findPlaces({
        ownerId: userId,
        type: typeParam || '',
        limit: limit,
      });

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

      /* ⭐ 交给数据层查 —— `_id` 和 `id` 的映射也在那边做了 */
      const place = await placesRepo.findPlaceById(id, userId);

      if (!place) {
        /* ⚠️ "不存在"和"存在但不属于你"**都返回 404** —— 契约 §四.2 特意定的：
           如果后者返回 403，就等于告诉别人"这条数据存在，只是不是你的"。 */
        sendError(res, 404, 'NOT_FOUND', '找不到这个地点，或它不属于当前用户');
        return;
      }

      sendOk(res, { place: place });
      return;
    } catch (err) {
      console.error('[TripMemo] GET /api/place 失败：', err);
      sendError(res, 500, 'SERVER_ERROR', (err && err.message) || err);
      return;
    }
  }

  /* ------------------------------------------------------------
     ⭐ POST /api/places —— 新增一个地点（契约 §四.3）
     ------------------------------------------------------------
     ⭐ 契约规定：`id` 和 `createdAt` **由服务端生成**，请求体里传了也忽略。
        ⚠️ 为什么 `createdAt` 必须用服务端时间：否则用户改一下本机时钟，
           就能伪造出"我 2019 年去过"这种记录。
     ⚠️ 它和 GET /api/places 是**同一路径、不同方法** —— 靠 `req.method` 区分。 */
  if (path === '/api/places' && req.method === 'POST') {
    try {
      /* ① 读请求体（⚠️ HTTP 函数要自己从 req 流里读，见 readJsonBody 的说明） */
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        sendError(res, 400, 'INVALID_INPUT', '请求体解析失败：' + e.message);
        return;
      }

      /* ② 校验必填字段（提示全是中文，并且说清缺了什么） */
      const checked = validateNewPlace(body);
      if (!checked.ok) {
        sendError(res, 400, 'INVALID_INPUT', checked.message);
        return;
      }
      const data = checked.data;

      /* ③ ⭐ 防重复（Day 18 定的规矩「甲」）：
            同一个用户 + 同一个坐标（lng / lat 完全相同）= 同一个地方。
         ⭐ 为什么这样判：坐标一样就是同一个物理地点。
            你要记的是"在那儿待了多久"，那就应该**把一条记录的时间范围拉长**，
            而不是插两条；而且补记过去时最容易重复提交，这一层正好挡住。
         ⭐ 注意只查**同一个 ownerId** —— 别人去过同一个坐标跟我没关系。 */
      const existed = await placesRepo.findExistingAtCoordinate(
        userId, data.lng, data.lat);
      if (existed) {
        sendError(res, 409, 'DUPLICATE_PLACE',
          '这个坐标上你已经有一个地点了：「' + (existed.name || '') + '」。'
          + '如果是要补记同一次停留，请编辑那一条的时间范围，不要新增。');
        return;
      }

      /* ④ 拼出完整文档：id 和 createdAt 都由服务端给 */
      const now = new Date();
      const doc = Object.assign({}, data, {
        _id: placesRepo.newPlaceId(),
        ownerId: userId,
        createdAt: now,
      });

      /* ⭐ 交给数据层插 —— 这里不出现 add() */
      await placesRepo.insertPlace(doc);

      /* ⭐ 余力加练：服务端日志 ——
         以后怀疑"到底写进去没"，去云函数的「日志」里搜 [TripMemo] 就能看到。 */
      console.log('[TripMemo] 新增地点成功 id=' + doc._id
        + ' name=' + doc.name
        + ' owner=' + doc.ownerId
        + ' at=' + now.toISOString());

      /* ⭐ 契约 §3.1 规定新增返回 **201**（不是 200）；
         ⭐ §四.3 规定返回**完整对象**而不是只返回 id ——
            这样前端拿到就能直接插进列表，不用再请求一次。 */
      sendOk(res, { place: toApiPlace(doc) }, 201);
      return;
    } catch (err) {
      console.error('[TripMemo] POST /api/places 失败：', err);
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
      /* ⭐ 直接拿"接口要的两个字段"，拼装逻辑在数据层 */
      const settings = await settingsRepo.getSettings(userId);
      sendOk(res, settings);
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

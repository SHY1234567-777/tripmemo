/* ============================================================
   settingsRepository.js —— settings 集合的「数据访问层」（Day 19 新增）
   ============================================================
   ⭐ 只管"怎么读写 settings 集合"。
   ⚠️ 看不到 `req` / `res` / 状态码。

   ⚠️ 目前只有两个查询（读设置、数条数）——
       这是**故意保持最小**：清单要求"不新增任何功能"，
       所以只搬现有的，不提前写将来才用的。
   ============================================================ */

const dbModule = require('../cloudbase');
const db = dbModule.db;

/* ⚠️ 集合名只在这里出现 */
const COLLECTION = 'settings';

/**
 * ⭐ 读某个用户的设置
 *
 * @param {string} ownerId
 * @returns {Promise<{mainCity: object|null, sampleLoaded: boolean}>}
 *          ⚠️ 即使这个用户还没有设置记录，也**返回默认值**（而不是 null）——
 *          因为契约 §四.6 要求响应里必须有这两个字段：
 *          `{ ok:true, mainCity, sampleLoaded }`
 *          ⭐ `mainCity` 允许是 `null`（用户还没设定主城市）——
 *            前端要能处理这种情况（地图上就没有连线起点）。
 */
async function getSettings(ownerId) {
  const result = await db.collection(COLLECTION)
    .where({ ownerId: ownerId })
    .limit(1)
    .get();

  const doc = (result.data || [])[0] || null;

  return {
    mainCity: (doc && doc.mainCity) ? doc.mainCity : null,
    sampleLoaded: doc ? !!doc.sampleLoaded : false,
  };
}

/**
 * ⭐ 数条数（给 `/api/db-check` 那个临时接口用）
 * @returns {Promise<number>}
 */
async function countAll() {
  const result = await db.collection(COLLECTION).get();
  return (result.data || []).length;
}

module.exports = {
  getSettings: getSettings,
  countAll: countAll,
};

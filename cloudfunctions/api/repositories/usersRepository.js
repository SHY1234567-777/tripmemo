/* ============================================================
   usersRepository.js —— users 集合的「数据访问层」（Day 19 新增）
   ============================================================
   ⭐ 只管"怎么读写 users 集合"。
   ⚠️ 看不到 `req` / `res` / 状态码。

   ⚠️ 现在只有 `countAll()` —— **2026-10-12 起已无调用方**（原来唯一的调用方
      `/api/db-check` 被删了）。⭐ 保留它是因为**后续账号体系会用**（users 集合本身还在）。
       ⭐ 之所以还是给它建一个独立文件（而不是塞给别的 repository）：
         · 它是一张独立的集合，将来 Day 20 加登录时**必然要在这儿加查询**；
         · ⚠️ 但**今天不提前写**（清单要求"不新增任何功能"）——
           等真要用时再加，那时只需动这一个文件。
   ============================================================ */

const dbModule = require('../cloudbase');
const db = dbModule.db;

/* ⚠️ 集合名只在这里出现 */
const COLLECTION = 'users';

/**
 * ⭐ 数条数
 *
 * ⚠️ 2026-10-12：原调用方 `/api/db-check` 已删（它泄露全库统计），**本方法目前暂无调用方**；保留给后续「统计面板」或账号体系用。
 * @returns {Promise<number>}
 */
async function countAll() {
  const result = await db.collection(COLLECTION).get();
  return (result.data || []).length;
}

module.exports = {
  countAll: countAll,
};

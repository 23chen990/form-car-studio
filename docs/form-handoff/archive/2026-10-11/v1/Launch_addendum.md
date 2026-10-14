# FORM 上架执行补充检查

核验日期：2026-10-11。本补充不改变主报告的 33 个外部来源索引，也不是针对全部市场的法律意见。未执行上架、账号配置或地区修改。

## 首发地区与商家身份

建议先明确首发地区，不把“海外”自动等同于所有国家。Apple 要求在欧盟商店分发的 trader 提供并公开经核验的地址、电话、邮箱；即使不向欧盟分发，仍需申报 trader status。身份需要开发者按实际情况评估，个人开发者不自动等于非商家。不能为隐藏联系信息而作虚假申报。[E01]

FORM 待办：由账号持有人确认主体、首发国家、适用身份及公开联系资料。此项不能由 Codex 根据代码推断。补充客服邮箱及用户可找到的支持入口；商店地区扩大前重新核验当地要求。

## 构建与审核可用性

自 2026-04-28 起，上传构建适用 Xcode 26 或更新版本及相应 26 系列 SDK 要求。[E02] 提交时应提供完整、可工作的产品；需要登录的功能应按审核要求提供可用访问方式，服务器和支持链接保持有效。[E03]

FORM 待办：准备审核说明，交代真实生成、额度消耗、失败处理和演示模式差异。不能仅给审核人员预制成功图片，却让普通用户使用未经验证的另一套路径。审核账号和凭据不提交公开仓库；测试预算与生产限额分别配置。

## 评价与客服

Apple 建议在用户完成有意义的操作后请求评价，避免打断创作；不能通过付费或激励方式操纵评价。[E03][E04]

FORM 待办：先完成自然创作流程和支持入口，再考虑系统评价请求。建议在完成任务后的中性时机触发，不以先问“满意吗”再仅向满意者索评的筛选流程替代真实反馈。不要用五星评价换生成次数。投诉与技术反馈应独立可用，而不是强迫用户修改公开评价。

## 官方来源

E01 — Apple，Manage European Union Digital Services Act trader requirements：
https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/

E02 — Apple，SDK minimum requirements：
https://developer.apple.com/news/upcoming-requirements/?id=04282026a

E03 — Apple，App Review Guidelines，重点核对 2.1、2.3、5.6：
https://developer.apple.com/app-store/review/guidelines/

E04 — Apple，Ratings, reviews, and responses：
https://developer.apple.com/app-store/ratings-and-reviews/
# 职位迁移矩阵

> 本文档记录从旧版 administrative.json（L1-L11 线性模型）到新版原生职位配置的最终映射决策。
> 最后更新：2026-07-22

**关键原则：机构层级跟随所属机构，领导职务层次独立。两者不互相推导。**

| 原职位 ID | 名称 | 原等级 | 机构 ID | 机构层级 | 岗位领域 | 领导职务层次 | contentTier |
|---|---|---:|---|---|---|---|---:|
| admin_l1_0 | 乡镇科员 | L1 | township_govt_01 | 乡镇街道 | 地方综合治理 | 无领导职务 | 0 |
| admin_l1_1 | 社区工作员 | L1 | subdistrict_01 | 乡镇街道 | 地方综合治理 | 无领导职务 | 0 |
| admin_l1_2 | 乡镇办事员 | L1 | township_govt_01 | 乡镇街道 | 地方综合治理 | 无领导职务 | 0 |
| admin_l2_0 | 副镇长 | L2 | township_govt_01 | 乡镇街道 | 地方综合治理 | 乡科级副职 | 2 |
| admin_l2_1 | 乡镇办公室主任 | L2 | township_govt_01 | 乡镇街道 | 地方综合治理 | 乡科级副职 | 2 |
| admin_l2_2 | 民政助理 | L2 | township_govt_01 | 乡镇街道 | 地方综合治理 | 乡科级副职 | 2 |
| admin_l3_0 | 镇长 | L3 | township_govt_01 | 乡镇街道 | 地方综合治理 | 乡科级正职 | 3 |
| admin_l3_1 | 乡镇党委委员 | L3 | township_party_01 | 乡镇街道 | 党委工作机关 | 乡科级正职 | 3 |
| admin_l3_2 | 科室主任 | L3 | county_govt_01 | 县区 | 地方综合治理 | 乡科级正职 | 3 |
| admin_l3_3 | 副乡镇党委书记 | L3 | township_party_01 | 乡镇街道 | 党委工作机关 | 乡科级正职 | 3 |
| admin_l4_0 | 副县长 | L4 | county_govt_01 | 县区 | 地方综合治理 | 县处级副职 | 4 |
| admin_l4_1 | 副区长 | L4 | district_govt_01 | 县区 | 地方综合治理 | 县处级副职 | 4 |
| admin_l4_2 | 市局副局长 | L4 | city_bureau_01 | 县区 | 地方综合治理 | 县处级副职 | 4 |
| admin_l4_3 | 县委常委 | L4 | county_party_01 | 县区 | 党委工作机关 | 县处级副职 | 4 |
| admin_l5_0 | 县长 | L5 | county_govt_01 | 县区 | 地方综合治理 | 县处级正职 | 5 |
| admin_l5_1 | 区长 | L5 | district_govt_01 | 县区 | 地方综合治理 | 县处级正职 | 5 |
| admin_l5_2 | 市局局长 | L5 | city_bureau_01 | 县区 | 地方综合治理 | 县处级正职 | 5 |
| admin_l5_3 | 县委书记 | L5 | county_party_01 | 县区 | 党委工作机关 | 县处级正职 | 5 |
| admin_l6_0 | 副市长 | L6 | city_govt_01 | 地级市 | 地方综合治理 | 厅局级副职 | 6 |
| admin_l6_1 | 省厅副厅长 | L6 | provincial_dept_01 | 地级市 | 地方综合治理 | 厅局级副职 | 6 |
| admin_l6_2 | 市委常委 | L6 | city_party_01 | 地级市 | 党委工作机关 | 厅局级副职 | 6 |
| admin_l7_0 | 市长 | L7 | city_govt_01 | 地级市 | 地方综合治理 | 厅局级正职 | 7 |
| admin_l7_1 | 省厅厅长 | L7 | provincial_dept_01 | 地级市 | 地方综合治理 | 厅局级正职 | 7 |
| admin_l7_2 | 市委书记 | L7 | city_party_01 | 地级市 | 党委工作机关 | 厅局级正职 | 7 |
| admin_l8_0 | 副省长 | L8 | province_govt_01 | 省级 | 地方综合治理 | 省部级副职 | 8 |
| admin_l8_1 | 省委常委 | L8 | province_party_01 | 省级 | 党委工作机关 | 省部级副职 | 8 |
| admin_l8_2 | 省人大副主任 | L8 | province_congress_01 | 省级 | 人大机关 | 省部级副职 | 8 |
| admin_l9_0 | 省长 | L9 | province_govt_01 | 省级 | 地方综合治理 | 省部级正职 | 9 |
| admin_l9_1 | 省委书记 | L9 | province_party_01 | 省级 | 党委工作机关 | 省部级正职 | 9 |
| admin_l9_2 | 省政协主席 | L9 | province_cppcc_01 | 省级 | 政协机关 | 省部级正职 | 9 |
| admin_l10_0 | 国家部委副部长 | L10 | ministry_01 | 中央 | 地方综合治理 | 省部级副职 | 10 |
| admin_l10_1 | 省委常委兼副省长 | L10 | province_govt_01 | 省级 | 地方综合治理 | 省部级副职 | 10 |
| admin_l10_2 | 中央委员 | L10 | central_party_01 | 中央 | 党委工作机关 | 省部级副职 | 10 |
| admin_l11_0 | 国家部委部长 | L11 | ministry_01 | 中央 | 地方综合治理 | 省部级正职 | 11 |
| admin_l11_1 | 省委书记兼省长 | L11 | province_party_01 | 省级 | 党委工作机关 | 省部级正职 | 11 |
| admin_l11_2 | 中央政治局委员 | L11 | central_party_01 | 中央 | 党委工作机关 | 国家级副职 | 11 |

## 映射说明

- 机构层级由所属机构决定（如国家部委 = central），不等于领导职务层次
- 领导职务层次由岗位本身决定（如副部长 = province_deputy）
- 中央委员、中央政治局委员为党成员身份，当前暂作为 PositionConfig 处理，后续应分离为独立成员身份
- contentTier 仅用于内容难度和解锁，不是职业事实

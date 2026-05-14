# AlphaReport — 量化研报收集与深度分析系统

基于 LangGraph 的智能研报 Agent，自动从多数据源获取量化金融论文和券商研报，支持多阶段 AI 深度分析（同行评议式方法论审查 + 公式解读 + 综合评估）。

## 功能概览

**研报收集**
- **多源并发检索** — 本地 PDF、arXiv 学术论文、东方财富券商研报
- **智能多维分类** — 关键词规则引擎 + LLM 混合分类，覆盖市场/资产/频率/主题
- **自动去重入库** — SQLite 存储，分面筛选，全文检索

**AI 深度分析（四阶段流水线）**
- **Phase 1 — 元数据提取**：研究问题、核心贡献、方法类别、数据特征
- **Phase 2 — 同行评议式方法论审查**：以期刊审稿人视角，每个论点强制引用论文公式作为证据
- **Phase 3 — 公式逐一解读**：LaTeX 公式的符号含义、公式作用、是否为关键公式
- **Phase 4 — 综合评估**：质量评分、偏差风险（look-ahead/survivorship/data-snooping）、可复现性、A 股适用性

**研报理解**
- **公式提取与渲染** — MinerU / Docling PDF 解析，KaTeX 前端渲染，自动修复 PDF 提取伪影
- **表格提取** — 多解析器表格抽取，前端原生 HTML 表格渲染
- **AI 总结** — 单阶段快速总结 + 多阶段深度分析双模式

## 架构

```
用户定义搜索标准
       │
       ▼
┌─── LangGraph Pipeline ───────────────────────────────────┐
│                                                          │
│  CollectionAgent → ClassificationAgent → StorageAgent    │
│       │                   │                   │         │
│  ┌────┴────┐         规则+LLM              SQLite        │
│  │    │    │                                             │
│ PDF arXiv 东方财富                                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
       │
       ▼
  FastAPI + SSE 流式推送
       │
       ▼
  React + TypeScript + KaTeX 前端
```

### AnalysisAgent 四阶段流水线

```
POST /api/v1/reports/{id}/analyze
       │
       ▼
┌─────────────┐    ┌──────────────────┐    ┌──────────────┐    ┌─────────────┐
│ Phase 1     │ →  │ Phase 2          │ →  │ Phase 3      │ →  │ Phase 4     │
│ 元数据提取   │    │ 同行评议(核心)    │    │ 公式解读      │    │ 综合评估     │
│ deepseek-chat│   │ deepseek-reasoner │   │ deepseek-chat │   │ deepseek-chat│
└─────────────┘    └──────────────────┘    └──────────────┘    └─────────────┘
       │                   │                     │                   │
       └───────────────────┴─────────────────────┴───────────────────┘
                                   │
                           SSE 实时推送每阶段结果
```

## 技术栈

| 层级 | 技术 |
|------|------|
| Agent 编排 | LangGraph StateGraph |
| 后端 API | FastAPI + WebSocket + SSE |
| 前端 | React + TypeScript + Vite + TailwindCSS |
| 公式渲染 | KaTeX |
| 数据库 | SQLite + SQLAlchemy |
| PDF 处理 | PyMuPDF + MinerU + Docling |
| LLM | OpenAI 兼容接口 (DeepSeek / GPT / 智谱 / 月之暗面) |

## 快速开始

### 1. 环境准备

```bash
git clone <repo-url>
cd AlphaReport

# Python 后端
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# React 前端
cd frontend-v2
npm install
cd ..
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，至少填入一个 LLM API Key
```

支持的 LLM 服务商：

| 服务商 | `OPENAI_BASE_URL` | model 示例 |
|--------|-------------------|-----------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| OpenAI | 不填 | `gpt-4o-mini` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 月之暗面 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |

不配置 LLM 也能使用收集和规则分类功能，分类退回到纯规则引擎模式。

如需切换模型，编辑 `configs/app.yaml` 中的 `llm` 字段。

### 3. 启动服务

**一键启动（推荐）：**

```bash
./start.sh
```

自动启动前后端，Ctrl+C 一键停止。

**分别启动：**

```bash
# 终端1 — 后端（端口 8000）
source .venv/bin/activate
PYTHONPATH=. python -m uvicorn reportagent.main:app --host 127.0.0.1 --port 8000 --reload

# 终端2 — 前端（端口 3000）
cd frontend-v2
npm run dev
```

打开 `http://localhost:3000`，API 文档 `http://localhost:8000/docs`。

### 4. 本地 PDF 研报

将 PDF 放入 `data/pdf_library/` 目录（支持子目录），收集时选择「本地PDF」数据源即可。

## 使用指南

### 收集研报

1. 首页选择研究主题（如「因子模型」「高频交易」），或输入自定义主题
2. 勾选数据源（本地PDF / arXiv / 东方财富）
3. 可选填附加关键词和最大结果数
4. 点击「开始收集」，自动跳转到任务监控页

### AI 深度分析

1. 在研报库中点击任意研报进入详情页
2. 点击「AI 深度分析（多阶段）」按钮
3. 系统按四个阶段依次执行，SSE 实时推送每阶段结果：
   - **研究概览** — 研究问题、核心贡献、数据样本、基准模型
   - **方法论审查** — 以同行评议视角，每个分析点强制引用论文公式
   - **公式解读** — 关键公式的符号含义和论文中的作用
   - **综合评估** — 质量评分、偏差风险、可复现性、A 股适用性

分析深度可通过 `configs/prompts/analysis.yaml` 中的 `depth` 字段配置：
- `quick` — 仅 Phase 1（~3s）
- `standard` — 全部 4 阶段（~15s）
- `deep` — 全部 4 阶段 + 全文输入（~30s）

### 研报库浏览

- 左侧边栏按市场/资产/频率/主题筛选
- 顶部搜索框支持标题和摘要全文检索
- 点击卡片进入详情页，查看元数据、公式、表格、分析结果

### 分类体系

| 维度 | 可选值 |
|------|--------|
| 市场 | 中国市场、海外市场、全球市场 |
| 资产 | 股票、期货/CTA、期权、固收、加密货币、多资产 |
| 频率 | 高频、中频、低频/日频+、混合 |
| 主题 | 风险模型、因子模型、AI/ML、执行算法、组合优化、微观结构、另类数据、波动率、统计套利 |

分类规则定义在 `configs/classification_taxonomy.yaml`，可自行扩充。

## API 接口

| 端点 | 说明 |
|------|------|
| `POST /api/v1/collection/start` | 启动收集任务 |
| `GET /api/v1/collection/{task_id}` | 查询任务状态 |
| `WS /ws/collection/{task_id}` | WebSocket 实时收集进度 |
| `GET /api/v1/reports` | 研报列表（分页/筛选/搜索） |
| `GET /api/v1/reports/{id}` | 研报详情 |
| `POST /api/v1/reports/{id}/summarize` | 快速 AI 总结（SSE 流式） |
| `POST /api/v1/reports/{id}/analyze?depth=standard` | 多阶段深度分析（SSE 流式） |
| `GET /api/v1/reports/stats` | 研报统计 |
| `GET /api/v1/classification/taxonomy` | 分类体系 |

## 项目结构

```
├── configs/
│   ├── app.yaml                        # 应用配置 (LLM provider/model/temperature)
│   ├── classification_taxonomy.yaml    # 分类关键词规则
│   └── prompts/
│       ├── analysis.yaml               # 四阶段分析 prompt 模板
│       └── chat_system.txt             # 对话系统 prompt
├── data/
│   ├── pdf_library/                    # 本地 PDF 存放目录
│   └── report_library.db               # SQLite 数据库（自动生成）
├── reportagent/
│   ├── agents/                         # LangGraph Agent 节点
│   │   ├── graph.py                    # Pipeline 编排
│   │   ├── state.py                    # Agent 状态定义
│   │   ├── collection_agent.py         # 收集节点
│   │   ├── classification_agent.py     # 分类节点
│   │   ├── analysis_agent.py           # 四阶段深度分析节点
│   │   └── storage_agent.py            # 存储节点
│   ├── sources/                        # 数据源适配器
│   │   ├── base.py
│   │   ├── local_pdf.py
│   │   ├── arxiv_source.py
│   │   └── eastmoney_source.py
│   ├── classifiers/                    # 分类引擎
│   │   ├── rule_classifier.py
│   │   └── llm_classifier.py
│   ├── processors/                     # PDF 处理与公式
│   │   ├── pdf_extractor.py            # PyMuPDF 文本提取
│   │   ├── mineru_parser.py            # MinerU 公式/表格提取
│   │   ├── docling_parser.py           # Docling 解析器
│   │   ├── formula_normalizer.py       # LaTeX 伪影修复
│   │   ├── math_latexifier.py          # 行内公式 → LaTeX 转换
│   │   └── metadata_extractor.py       # 论文元数据提取
│   ├── api/                            # FastAPI 路由
│   │   ├── collection.py
│   │   ├── reports.py
│   │   ├── classification.py
│   │   ├── chat.py
│   │   └── system.py
│   ├── models/                         # 数据模型
│   │   ├── schemas.py                  # Pydantic schema
│   │   └── database.py                 # SQLAlchemy ORM
│   ├── db/                             # 数据库层
│   ├── llm/                            # LLM 客户端
│   │   └── client.py                   # OpenAI/Anthropic 统一接口
│   ├── main.py                         # FastAPI 入口
│   └── utils/                          # 工具函数
├── frontend-v2/                        # React 前端
│   └── src/
│       ├── pages/                      # 页面组件
│       │   ├── HomePage.tsx            # 首页（搜索+收集配置）
│       │   ├── ReportDetailPage.tsx    # 研报详情（公式/表格/分析）
│       │   ├── TaskMonitorPage.tsx     # 任务监控
│       │   └── ChatPage.tsx            # AI 对话
│       ├── components/                 # UI 组件
│       ├── services/                   # API 调用
│       └── types/                      # TypeScript 类型
├── tests/                              # 测试
├── .env.example                        # API Key 配置模板
├── .gitignore
├── requirements.txt
├── start.sh                            # 一键启动脚本
└── README.md
```

## 扩展

### 添加新数据源

实现 `reportagent/sources/base.py` 中的 `BaseSource` 接口：

```python
class MySource(BaseSource):
    async def search(self, criteria: UserCriteria) -> list[SearchResult]: ...
    def is_available(self) -> bool: ...
    @property
    def source_type(self) -> SourceType: ...
```

然后在 `reportagent/agents/graph.py` 的 `_build_sources()` 中注册。

### 自定义分析深度

编辑 `configs/prompts/analysis.yaml`：

- 调整 `depth` 控制分析阶段数量
- 修改每个 phase 的 `system_prompt` 定制分析视角
- 修改 `output_schema` 定制输出结构

### 添加新分类维度

编辑 `configs/classification_taxonomy.yaml`，添加新维度和关键词即可。

## 常见问题

**Q: 深度分析提示"公式提取失败"？**
确保 PDF 已用 MinerU 或 Docling 预提取过公式。在研报详情页的「公式」Tab 确认公式是否已提取。

**Q: 前端公式渲染异常？**
检查公式是否为标准 LaTeX 格式（`$...$` / `$$...$$`）。系统已对 MinerU 常见提取伪影做了自动修复（`formula_normalizer.py`）。

**Q: 东方财富数据源无法获取全文？**
东方财富公开 API 仅返回结构化摘要，不提供全文。详情页会提供原文链接供手动查看。

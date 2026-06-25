/**
 * Config 片段装配根——副作用 import 各域的 fragment 文件以触发注册（defineConfigFragment）。
 * AgentService 聚合时读 getConfigFragments()，不直接认识任何域。
 * 新增一个域的对话配置 = 新建 fragment 文件 + 在此加一行 import。
 */
import '@/server/modules/memory/domain/service/compaction-config';
import '@/server/libs/config/upload-config';
import '@/server/modules/agent/application/service/model-config.fragment';

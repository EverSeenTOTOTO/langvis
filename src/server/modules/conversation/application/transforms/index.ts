// Barrel：import 触发各 transform 的 @convTransform 自注册。导入序即同相位运行序（无 priority）
// ——turn-end 须 compact → usage（先折叠、再量用量）。
import './summary-attach-transform';
import './compact-transform';
import './usage-transform';

export { resolveConvTransforms, convTransform } from './registry';
export { runConvTransforms, getConvTransformPlan } from './run-transforms';

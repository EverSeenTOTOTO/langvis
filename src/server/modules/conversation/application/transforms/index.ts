// Barrel：import 触发各 transform 的 @convTransform 自注册。导入序即同相位运行序（无 priority）
// ——turn-end 须 process-summary → compact → usage（先烘 summary 列、再折叠历史、最后量压缩后用量）。
import './process-summary-transform';
import './compact-transform';
import './usage-transform';

export { resolveConvTransforms, convTransform } from './registry';
export { runConvTransforms, getConvTransformPlan } from './run-transforms';

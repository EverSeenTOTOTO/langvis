// Barrel：import 触发各 transform 的 @convTransform 自注册；**导入序即 turn-end 运行序**
// （无 priority，靠导入序）——须为 summary-bake → compact → usage（先烘焙、再折叠、最后量用量）。
import './summary-bake-transform';
import './compact-transform';
import './usage-transform';

export { resolveConvTransforms, convTransform } from './registry';
export { runConvTransforms, getConvTransformPlan } from './run-transforms';

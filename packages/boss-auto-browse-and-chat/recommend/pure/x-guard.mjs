/** 是否对被筛掉的候选人点"不感兴趣"(X)。仅在显式设为 false 时抑制(只跳过不点)。 */
export function shouldClickX (cfg) {
  return cfg?.clickNotInterestedForFiltered !== false
}

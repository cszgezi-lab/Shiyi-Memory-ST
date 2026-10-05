// Fixed, content-free labels shared by validation, diagnostics and feedback.
export const PERSONA_ISSUES=Object.freeze({
  missing_name:'缺少人物姓名',invalid_text:'档案正文缺失或不是文字',unsafe_text:'档案正文含脚本或内部注入标记',
  invalid_floors:'来源楼号缺失或不在本批原文中',ambiguous_name:'姓名无法唯一对应本批人物',duplicate_profile:'同一人物返回了多份档案',
  empty_profile:'新人物没有可独立阅读的档案',invalid_updates:'局部修改不是列表',unknown_ref:'局部修改引用的片段不属于该人物或不存在',
  duplicate_ref:'同一片段被重复修改',empty_edit:'局部修改内容为空或不是文字',invalid_edit_floors:'局部修改的依据楼号不在本批',unsafe_edit:'局部修改含脚本或内部注入标记',
  repair_target:'纠错回答遗漏目标人物或返回了其它人物',invalid_json:'回答不是完整JSON',missing_profiles:'回答缺少人物列表',
});
export const PERSONA_RECOVERY_VERSION=1;
export function personaValidationError(issue,details={}){
 return Object.assign(new Error(PERSONA_ISSUES[issue]??'人物回答未通过校验'),{code:'PERSONA_RESPONSE_INVALID',details:{stage:'validate',reason:'persona_fields',modelRole:'dynamicPersona',personaIssue:issue,...details}});
}

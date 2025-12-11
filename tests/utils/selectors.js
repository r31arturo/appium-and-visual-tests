// Shared mobile selector templates to keep platform locators consistent.
// iOS predicate format reference:
//   -ios predicate string:name == "<accessibility id>"
// Android UiSelector reference:
//   android=new UiSelector().resourceId("<resource id>")

const iosPredicateName = (name) => `-ios predicate string:name == "${name}"`;
const androidResourceId = (id) => `android=new UiSelector().resourceId("${id}")`;
const accessibilityId = (id) => `accessibility id:${id}`;

module.exports = {
  iosPredicateName,
  androidResourceId,
  accessibilityId,
};

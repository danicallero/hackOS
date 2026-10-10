const { companyTagFilters } = require("../plugins/withAndroidCompanyTagLinks.js");

describe("withAndroidCompanyTagLinks (#935)", () => {
  it("verifies https /s/ links", () => {
    const [view] = companyTagFilters("os.hackudc.com");
    const data = [
      {
        $: {
          "android:scheme": "https",
          "android:host": "os.hackudc.com",
          "android:pathPrefix": "/s/",
        },
      },
    ];
    expect(companyTagFilters("os.hackudc.com")).toHaveLength(1);
    expect(view).toEqual({
      $: { "android:autoVerify": "true" },
      action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
      category: [
        { $: { "android:name": "android.intent.category.DEFAULT" } },
        { $: { "android:name": "android.intent.category.BROWSABLE" } },
      ],
      data,
    });
  });
});

const { companyTagFilters } = require("../plugins/withAndroidCompanyTagLinks.js");

describe("withAndroidCompanyTagLinks (#935)", () => {
  it("verifies https /s/ links and receives tapped tags carrying them", () => {
    const [view, ndef] = companyTagFilters("os.hackudc.com");
    const data = [
      {
        $: {
          "android:scheme": "https",
          "android:host": "os.hackudc.com",
          "android:pathPrefix": "/s/",
        },
      },
    ];
    expect(view).toEqual({
      $: { "android:autoVerify": "true" },
      action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
      category: [
        { $: { "android:name": "android.intent.category.DEFAULT" } },
        { $: { "android:name": "android.intent.category.BROWSABLE" } },
      ],
      data,
    });
    expect(ndef).toEqual({
      action: [{ $: { "android:name": "android.nfc.action.NDEF_DISCOVERED" } }],
      category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
      data,
    });
  });
});

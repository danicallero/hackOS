/** H11: preserve section ownership and the position of standalone questions. */
export function groupApplicationFields<
  Field extends { section_key?: string; after_section_key?: string },
  Section extends { key: string },
>(fields: Field[], sections: Section[]): { section: Section | null; fields: Field[] }[] {
  const keys = new Set(sections.map((section) => section.key));
  const standalone = fields.filter((field) => !field.section_key || !keys.has(field.section_key));
  const groups: { section: Section | null; fields: Field[] }[] = [
    {
      section: null,
      fields: standalone.filter(
        (field) => !field.after_section_key || !keys.has(field.after_section_key),
      ),
    },
  ];
  for (const section of sections) {
    groups.push({ section, fields: fields.filter((field) => field.section_key === section.key) });
    groups.push({
      section: null,
      fields: standalone.filter((field) => field.after_section_key === section.key),
    });
  }
  return groups.filter((group) => group.fields.length > 0);
}

/** A field a person may add to a list as a column. */
export type ExtraFieldDef = {
  /** Field key; the column's key in the table is `x:<key>`. */
  key: string;
  label: string;
  group?: string;
};

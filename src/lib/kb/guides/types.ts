/** One screenshot of a shipped guide: a file in /public/kb, shown where the body says `![](shot:N)`. */
export type GuideShot = { file: string /* name in /public/kb, without .jpg */; caption: string; alt?: string };

export type StarterFolder = { slug: string; name: string; description: string };

export type StarterGuide = {
  slug: string;
  folder: string; // StarterFolder.slug
  title: string;
  /** The description shown on the card and under the title. */
  hook: string;
  minutes: number;
  /** Markdown. Place screenshot N with a line of its own: `![caption](shot:N)`. */
  body: string;
  shots: GuideShot[];
};

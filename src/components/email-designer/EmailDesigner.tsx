"use client";

/**
 * Zoho-style Email Template Designer.
 *
 * Two authoring modes:
 *   - "Designer"  → block-based UI: drag from a palette, configure inline, see live preview
 *   - "HTML"      → raw HTML editor with merge-field hinting
 *
 * Both modes share: subject, preheader, theme (brand color, logo, fonts), and
 * the auto-generated SEBI footer.
 *
 * Designed as a controlled component — parent owns the EmailDesignerBody.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  Type as TypeIcon,
  Heading as HeadingIcon,
  Image as ImageIcon,
  Images,
  MousePointerClick,
  Minus,
  ArrowUpDown,
  Quote,
  Share2,
  Table as TableIcon,
  Code,
  Trash2,
  ChevronUp,
  GripVertical,
  ChevronDown,
  PaintBucket,
  Eye,
  Smartphone,
  Monitor,
  Palette,
  Variable,
  Sparkles,
  X,
} from "lucide-react";
import type { EmailDesignerBody, EmailBlock, EmailTheme } from "@/lib/email-designer/types";
import { mergeFieldsByCategory, type MergeField } from "@/lib/email-designer/merge-fields";

type Mode = "designer" | "html";

export function EmailDesigner({
  value,
  onChange,
  tenant,
}: {
  value: EmailDesignerBody;
  onChange: (next: EmailDesignerBody) => void;
  tenant?: { displayName?: string | null; arn?: string | null; logoUrl?: string | null; brandColor?: string | null };
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [sidebarTab, setSidebarTab] = useState<"blocks" | "theme" | "fields">("blocks");
  const [previewHtml, setPreviewHtml] = useState<string>("");

  const mode = (value.mode ?? "designer") as Mode;
  const theme: EmailTheme = useMemo(
    () =>
      (value.theme ?? {
        brandColor: tenant?.brandColor ?? "#0ea5e9",
        accentColor: "#0e2557",
        pageBackground: "#f5f7fb",
        cardBackground: "#ffffff",
        textColor: "#111827",
        mutedColor: "#6b7280",
        fontFamily: "sans",
        baseFontSize: 15,
        containerWidth: 600,
        cornerRadius: 12,
        logoHeight: 40,
        logoAlign: "center",
        logoUrl: tenant?.logoUrl ?? undefined,
      }) as EmailTheme,
    [value.theme, tenant]
  );

  // Initialise blocks with sensible defaults
  useEffect(() => {
    if (mode === "designer" && (!value.blocks || value.blocks.length === 0)) {
      onChange({
        ...value,
        blocks: [
          mkBlock("logo", {}),
          mkBlock("hero", { title: "Welcome, {{investor.name}}", subtitle: "Thank you for choosing {{tenant.displayName}}." }),
          mkBlock("text", { html: "We're delighted to be your wealth-management partner. This is the start of a long, fruitful relationship." }),
          mkBlock("button", { label: "View dashboard", url: "{{system.dashboard_url}}" }),
        ],
        theme,
      });
    }
  }, []);

  // Live preview refresh — server renders
  const debounce = useRef<NodeJS.Timeout | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      void fetch("/api/email-designer/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: value }),
      })
        .then(async (r) => {
          if (!r.ok) {
            setPreviewError(`Preview API returned ${r.status}`);
            return { html: "" };
          }
          setPreviewError(null);
          return r.json();
        })
        .then((d) => setPreviewHtml(d.html ?? ""))
        .catch(() => setPreviewHtml(""));
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [value]);

  function update<K extends keyof EmailDesignerBody>(patch: Partial<EmailDesignerBody>) {
    onChange({ ...value, ...patch });
  }
  function updateTheme(patch: Partial<EmailTheme>) {
    onChange({ ...value, theme: { ...theme, ...patch } });
  }
  function addBlock(type: any) {
    const b = mkBlock(type, {});
    update({ blocks: [...(value.blocks ?? []), b] });
    setSelectedId(b.id);
    setSidebarTab("blocks");
  }
  function updateBlock(id: string, patch: any) {
    update({
      blocks: (value.blocks ?? []).map((b: any) => (b.id === id ? { ...b, ...patch } : b)),
    });
  }
  function removeBlock(id: string) {
    update({ blocks: (value.blocks ?? []).filter((b: any) => b.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }
  function moveBlock(id: string, dir: -1 | 1) {
    const arr = [...(value.blocks ?? [])];
    const idx = arr.findIndex((b: any) => b.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    update({ blocks: arr });
  }
  /** Drag-drop reorder: move `fromId` to occupy `toId`'s position. */
  function moveBlockTo(fromId: string, toId: string) {
    if (fromId === toId) return;
    const arr = [...(value.blocks ?? [])];
    const from = arr.findIndex((b: any) => b.id === fromId);
    const to = arr.findIndex((b: any) => b.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    update({ blocks: arr });
  }
  function insertMergeField(field: MergeField) {
    // Insert into the currently-focused input if any; otherwise into the
    // selected block's primary text field.
    const token = `{{${field.token}}}`;
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (active && ("value" in active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      const start = (active as any).selectionStart ?? active.value.length;
      const end = (active as any).selectionEnd ?? active.value.length;
      const newVal = active.value.slice(0, start) + token + active.value.slice(end);
      const evt = new Event("input", { bubbles: true });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (active.tagName === "INPUT" && setter) setter.call(active, newVal);
      else {
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        taSetter?.call(active, newVal);
      }
      active.dispatchEvent(evt);
      try {
        (active as any).setSelectionRange(start + token.length, start + token.length);
      } catch {
        /* noop */
      }
    } else {
      // Append to subject as a fallback
      update({ subject: `${value.subject ?? ""}${token}` });
    }
  }
  const selectedBlock = (value.blocks ?? []).find((b: any) => b.id === selectedId);

  return (
    <div className="card-surface overflow-hidden grid grid-cols-[280px_1fr_320px] min-h-[700px]">
      {/* LEFT SIDEBAR — palette / theme / merge fields */}
      <div className="border-r border-border flex flex-col">
        <div className="px-3 py-2 border-b border-border flex gap-1">
          <TabButton active={sidebarTab === "blocks"} onClick={() => setSidebarTab("blocks")} icon={Sparkles} label="Blocks" />
          <TabButton active={sidebarTab === "theme"} onClick={() => setSidebarTab("theme")} icon={Palette} label="Theme" />
          <TabButton active={sidebarTab === "fields"} onClick={() => setSidebarTab("fields")} icon={Variable} label="Fields" />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {sidebarTab === "blocks" && <BlockPalette onAdd={addBlock} disabled={mode === "html"} />}
          {sidebarTab === "theme" && <ThemePanel theme={theme} onChange={updateTheme} footer={value.footer ?? {}} onFooterChange={(f) => update({ footer: f })} />}
          {sidebarTab === "fields" && <MergeFieldPicker onPick={insertMergeField} />}
        </div>
      </div>

      {/* CENTER — header + canvas (designer or html) + preview */}
      <div className="flex flex-col min-w-0">
        {/* Header bar — subject, preheader, mode toggle, preview device */}
        <div className="border-b border-border p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Subject</label>
              <input
                value={value.subject ?? ""}
                onChange={(e) => update({ subject: e.target.value })}
                placeholder="Subject line — visible in the inbox"
                className="input-base text-xs w-full"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Preheader (inbox preview)</label>
              <input
                value={value.preheader ?? ""}
                onChange={(e) => update({ preheader: e.target.value })}
                placeholder="Short preview text shown after the subject"
                className="input-base text-xs w-full"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <ModeChip active={mode === "designer"} onClick={() => update({ mode: "designer" })} label="Designer" />
              <ModeChip active={mode === "html"} onClick={() => update({ mode: "html" })} label="HTML" />
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <button
                onClick={() => setDevice("desktop")}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${device === "desktop" ? "bg-brand-cyan-light text-brand-cyan-deep" : ""}`}
              >
                <Monitor className="size-3.5" /> Desktop
              </button>
              <button
                onClick={() => setDevice("mobile")}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${device === "mobile" ? "bg-brand-cyan-light text-brand-cyan-deep" : ""}`}
              >
                <Smartphone className="size-3.5" /> Mobile
              </button>
            </div>
          </div>
        </div>

        {/* Canvas — designer list or HTML textarea */}
        <div className="flex-1 overflow-y-auto bg-secondary/30 p-4">
          {mode === "designer" ? (
            <div className="space-y-2">
              {(value.blocks ?? []).length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-10">
                  Add a block from the left to start building your email.
                </div>
              )}
              {(value.blocks ?? []).map((b: any) => (
                <BlockCard
                  key={b.id}
                  block={b}
                  selected={selectedId === b.id}
                  onSelect={() => setSelectedId(b.id)}
                  onChange={(patch) => updateBlock(b.id, patch)}
                  onRemove={() => removeBlock(b.id)}
                  onMoveUp={() => moveBlock(b.id, -1)}
                  onMoveDown={() => moveBlock(b.id, 1)}
                  dragging={dragId === b.id}
                  onDragStartBlock={() => setDragId(b.id)}
                  onDragEndBlock={() => setDragId(null)}
                  onDropOnBlock={() => { if (dragId) moveBlockTo(dragId, b.id); setDragId(null); }}
                />
              ))}
            </div>
          ) : (
            <HtmlMode
              html={value.html ?? ""}
              onChange={(html) => update({ html })}
            />
          )}
        </div>
      </div>

      {/* RIGHT — live preview */}
      <div className="border-l border-border flex flex-col">
        <div className="px-3 py-2 border-b border-border text-xs font-semibold flex items-center gap-1.5">
          <Eye className="size-3.5 text-brand-cyan" /> Live preview
        </div>
        <div className="flex-1 overflow-y-auto bg-secondary/30 p-3">
          <div
            className="bg-white shadow rounded overflow-hidden mx-auto"
            style={{ width: device === "mobile" ? 320 : "100%", maxWidth: device === "mobile" ? 320 : 600 }}
          >
            <iframe
              title="Email preview"
              srcDoc={
                previewHtml ||
                (previewError
                  ? `<div style='padding:32px;color:#b91c1c;text-align:center;font-family:system-ui;'>Preview unavailable — ${previewError}.<br/><span style='color:#6b7280;font-size:12px'>Your email content is saved; this is just a preview issue.</span></div>`
                  : "<div style='padding:32px;color:#6b7280;text-align:center;font-family:system-ui;'>Rendering preview…</div>")
              }
              className="w-full"
              style={{ height: 800, border: 0 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SIDEBAR — palette, theme, merge fields
// =============================================================================

function TabButton({ active, onClick, icon: Icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] flex-1 justify-center ${
        active ? "bg-brand-cyan-light text-brand-cyan-deep font-semibold" : "text-muted-foreground hover:bg-secondary/40"
      }`}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}

const PALETTE: Array<{ type: any; label: string; icon: any }> = [
  { type: "logo", label: "Logo", icon: ImageIcon },
  { type: "hero", label: "Hero", icon: Sparkles },
  { type: "heading", label: "Heading", icon: HeadingIcon },
  { type: "text", label: "Text", icon: TypeIcon },
  { type: "button", label: "Button", icon: MousePointerClick },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "image_row", label: "Image row", icon: Images },
  { type: "data_table", label: "Data table", icon: TableIcon },
  { type: "divider", label: "Divider", icon: Minus },
  { type: "spacer", label: "Spacer", icon: ArrowUpDown },
  { type: "quote", label: "Quote", icon: Quote },
  { type: "social", label: "Social", icon: Share2 },
  { type: "html", label: "Custom HTML", icon: Code },
];

function BlockPalette({ onAdd, disabled }: { onAdd: (t: any) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Add a block</div>
      {disabled && (
        <div className="text-[11px] text-muted-foreground italic mb-2">
          Switch to <strong>Designer</strong> mode to use blocks. HTML mode is a raw paste-area.
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {PALETTE.map((p) => (
          <button
            key={p.type}
            disabled={disabled}
            onClick={() => onAdd(p.type)}
            className="flex flex-col items-center gap-1 p-2 rounded-md border border-border hover:bg-brand-cyan-light/30 disabled:opacity-40 text-xs"
          >
            <p.icon className="size-4 text-brand-cyan" />
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemePanel({
  theme,
  onChange,
  footer,
  onFooterChange,
}: {
  theme: EmailTheme;
  onChange: (patch: Partial<EmailTheme>) => void;
  footer: any;
  onFooterChange: (f: any) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <Section title="Brand colors">
        <ColorRow label="Primary" value={theme.brandColor} onChange={(v) => onChange({ brandColor: v })} />
        <ColorRow label="Accent (headings)" value={theme.accentColor} onChange={(v) => onChange({ accentColor: v })} />
        <ColorRow label="Page background" value={theme.pageBackground} onChange={(v) => onChange({ pageBackground: v })} />
        <ColorRow label="Card background" value={theme.cardBackground} onChange={(v) => onChange({ cardBackground: v })} />
      </Section>

      <Section title="Logo">
        <label className="text-[10px] text-muted-foreground">Logo URL</label>
        <input
          value={theme.logoUrl ?? ""}
          onChange={(e) => onChange({ logoUrl: e.target.value })}
          placeholder="https://…/logo.png"
          className="input-base text-xs w-full"
        />
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div>
            <label className="text-[10px] text-muted-foreground">Logo height</label>
            <input
              type="number"
              min={20}
              max={120}
              value={theme.logoHeight ?? 40}
              onChange={(e) => onChange({ logoHeight: Number(e.target.value) })}
              className="input-base text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Logo align</label>
            <select
              value={theme.logoAlign ?? "center"}
              onChange={(e) => onChange({ logoAlign: e.target.value as any })}
              className="input-base text-xs w-full"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Typography">
        <label className="text-[10px] text-muted-foreground">Font family</label>
        <select
          value={theme.fontFamily ?? "sans"}
          onChange={(e) => onChange({ fontFamily: e.target.value as any })}
          className="input-base text-xs w-full"
        >
          <option value="sans">Sans-serif (system)</option>
          <option value="serif">Serif (Georgia)</option>
          <option value="modern">Modern (Inter)</option>
          <option value="rounded">Rounded</option>
        </select>
        <label className="text-[10px] text-muted-foreground mt-2 block">Base font size (px)</label>
        <input
          type="number"
          min={12}
          max={20}
          value={theme.baseFontSize ?? 15}
          onChange={(e) => onChange({ baseFontSize: Number(e.target.value) })}
          className="input-base text-xs w-full"
        />
      </Section>

      <Section title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">Container width</label>
            <input
              type="number"
              min={480}
              max={800}
              value={theme.containerWidth ?? 600}
              onChange={(e) => onChange({ containerWidth: Number(e.target.value) })}
              className="input-base text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Corner radius</label>
            <input
              type="number"
              min={0}
              max={24}
              value={theme.cornerRadius ?? 12}
              onChange={(e) => onChange({ cornerRadius: Number(e.target.value) })}
              className="input-base text-xs w-full"
            />
          </div>
        </div>
      </Section>

      <Section title="Footer (SEBI compliance)">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={footer.includeArn ?? true}
            onChange={(e) => onFooterChange({ ...footer, includeArn: e.target.checked })}
          />
          Include ARN / EUIN line
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={footer.includeAddress ?? true}
            onChange={(e) => onFooterChange({ ...footer, includeAddress: e.target.checked })}
          />
          Include firm address
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={footer.includeUnsubscribe ?? true}
            onChange={(e) => onFooterChange({ ...footer, includeUnsubscribe: e.target.checked })}
          />
          Include unsubscribe link
        </label>
        <label className="text-[10px] text-muted-foreground mt-2 block">Custom footer text (optional)</label>
        <textarea
          rows={2}
          value={footer.customText ?? ""}
          onChange={(e) => onFooterChange({ ...footer, customText: e.target.value })}
          className="input-base text-xs w-full"
        />
      </Section>
    </div>
  );
}

function MergeFieldPicker({ onPick }: { onPick: (f: MergeField) => void }) {
  const cats = mergeFieldsByCategory();
  return (
    <div className="space-y-3 text-xs">
      <div className="text-[10px] text-muted-foreground">
        Click any field to insert it into the focused input. Use{" "}
        <code className="bg-secondary px-1 rounded">{`{{token}}`}</code> syntax anywhere in your text.
      </div>
      {Object.entries(cats).map(([cat, fields]) => (
        <div key={cat}>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{cat}</div>
          <div className="space-y-0.5">
            {fields.map((f) => (
              <button
                key={f.token}
                onClick={() => onPick(f)}
                className="w-full text-left rounded hover:bg-brand-cyan-light/40 p-1.5"
              >
                <div className="text-xs font-medium">{f.label}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{`{{${f.token}}}`}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// CANVAS — block card + per-type editor
// =============================================================================

function BlockCard({
  block,
  selected,
  onSelect,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  dragging,
  onDragStartBlock,
  onDragEndBlock,
  onDropOnBlock,
}: {
  block: any;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: any) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragging?: boolean;
  onDragStartBlock?: () => void;
  onDragEndBlock?: () => void;
  onDropOnBlock?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={(e) => { e.preventDefault(); onDropOnBlock?.(); }}
      className={`bg-white border rounded-lg p-3 cursor-pointer transition-shadow ${
        selected ? "border-brand-cyan shadow-md" : "border-border hover:shadow-sm"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center justify-between mb-2 -mt-1">
        <div className="flex items-center gap-1">
          <span
            draggable
            onDragStart={onDragStartBlock}
            onDragEnd={onDragEndBlock}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder"
            className="cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </span>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{block.type.replace(/_/g, " ")}</div>
        </div>
        <div className="flex items-center gap-0.5 opacity-60 hover:opacity-100">
          <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} className="btn-icon h-6 w-6"><ChevronUp className="size-3" /></button>
          <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} className="btn-icon h-6 w-6"><ChevronDown className="size-3" /></button>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="btn-icon h-6 w-6 text-rose-600"><Trash2 className="size-3" /></button>
        </div>
      </div>
      <BlockEditor block={block} onChange={onChange} />
    </div>
  );
}

function BlockEditor({ block, onChange }: { block: any; onChange: (patch: any) => void }) {
  switch (block.type) {
    case "logo":
      return <div className="text-[11px] text-muted-foreground italic">Logo URL is set in the Theme panel.</div>;
    case "hero":
      return (
        <div className="space-y-1.5">
          <input value={block.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Hero title" className="input-base text-sm w-full" />
          <input value={block.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Subtitle" className="input-base text-xs w-full" />
          <input value={block.imageUrl ?? ""} onChange={(e) => onChange({ imageUrl: e.target.value })} placeholder="Hero image URL (optional)" className="input-base text-xs w-full" />
          <SelectInline label="Align" value={block.align ?? "center"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }]} />
        </div>
      );
    case "heading":
      return (
        <div className="space-y-1.5">
          <input value={block.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} className="input-base text-sm w-full font-semibold" />
          <div className="flex gap-1.5">
            <SelectInline label="Level" value={block.level} onChange={(v) => onChange({ level: v })} options={[{ value: "h1", label: "H1" }, { value: "h2", label: "H2" }, { value: "h3", label: "H3" }]} />
            <SelectInline label="Align" value={block.align ?? "left"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
          </div>
        </div>
      );
    case "text":
      return (
        <div>
          <textarea
            rows={3}
            value={block.html ?? ""}
            onChange={(e) => onChange({ html: e.target.value })}
            placeholder="Paragraph text — supports basic HTML: <b>, <i>, <a href='…'>, <br>"
            className="input-base text-xs w-full"
          />
          <SelectInline label="Align" value={block.align ?? "left"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
        </div>
      );
    case "button":
      return (
        <div className="space-y-1.5">
          <input value={block.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="Button label" className="input-base text-sm w-full" />
          <input value={block.url ?? ""} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://…" className="input-base text-xs w-full font-mono" />
          <div className="flex gap-1.5">
            <SelectInline label="Style" value={block.style ?? "solid"} onChange={(v) => onChange({ style: v })} options={[{ value: "solid", label: "Solid" }, { value: "outline", label: "Outline" }]} />
            <SelectInline label="Align" value={block.align ?? "center"} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
            <label className="flex items-center gap-1 text-[11px]">
              <input type="checkbox" checked={block.fullWidth ?? false} onChange={(e) => onChange({ fullWidth: e.target.checked })} /> Full width
            </label>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="space-y-1.5">
          <input value={block.url ?? ""} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://…/image.png" className="input-base text-xs w-full font-mono" />
          <div className="grid grid-cols-3 gap-1.5">
            <input value={block.alt ?? ""} onChange={(e) => onChange({ alt: e.target.value })} placeholder="Alt text" className="input-base text-xs col-span-2" />
            <input type="number" value={block.width ?? 560} onChange={(e) => onChange({ width: Number(e.target.value) })} placeholder="Width" className="input-base text-xs" />
          </div>
          <input value={block.linkUrl ?? ""} onChange={(e) => onChange({ linkUrl: e.target.value })} placeholder="Optional link URL (image becomes clickable)" className="input-base text-xs w-full font-mono" />
        </div>
      );
    case "image_row":
      return (
        <div className="space-y-1.5">
          {(block.items ?? []).map((it: any, i: number) => (
            <div key={i} className="flex gap-1.5">
              <input value={it.url} onChange={(e) => onChange({ items: block.items.map((x: any, ix: number) => (ix === i ? { ...x, url: e.target.value } : x)) })} placeholder={`Image ${i + 1} URL`} className="input-base text-xs flex-1 font-mono" />
              <input value={it.alt ?? ""} onChange={(e) => onChange({ items: block.items.map((x: any, ix: number) => (ix === i ? { ...x, alt: e.target.value } : x)) })} placeholder="Alt" className="input-base text-xs w-24" />
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                items: [
                  ...(block.items ?? []),
                  { url: "", alt: "" },
                ].slice(0, 3),
              })
            }
            className="btn-ghost text-[11px]"
          >
            + Add image (max 3)
          </button>
        </div>
      );
    case "data_table":
      return (
        <div className="space-y-1.5">
          <input value={block.caption ?? ""} onChange={(e) => onChange({ caption: e.target.value })} placeholder="Caption (optional)" className="input-base text-xs w-full" />
          {(block.rows ?? []).map((r: any, i: number) => (
            <div key={i} className="flex gap-1.5 items-center">
              <input value={r.label} onChange={(e) => onChange({ rows: block.rows.map((x: any, ix: number) => (ix === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" className="input-base text-xs flex-1" />
              <input value={r.value} onChange={(e) => onChange({ rows: block.rows.map((x: any, ix: number) => (ix === i ? { ...x, value: e.target.value } : x)) })} placeholder="Value" className="input-base text-xs flex-1 font-mono" />
              <button onClick={() => onChange({ rows: block.rows.filter((_: any, ix: number) => ix !== i) })} className="btn-icon h-7 text-rose-600">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => onChange({ rows: [...(block.rows ?? []), { label: "", value: "" }] })} className="btn-ghost text-[11px]">
            + Add row
          </button>
        </div>
      );
    case "divider":
      return (
        <div className="flex gap-2 items-center">
          <label className="text-[11px]">Thickness</label>
          <input type="number" min={1} max={6} value={block.thickness ?? 1} onChange={(e) => onChange({ thickness: Number(e.target.value) })} className="input-base text-xs w-16" />
          <label className="text-[11px]">Color</label>
          <input type="color" value={block.color ?? "#e5e7eb"} onChange={(e) => onChange({ color: e.target.value })} className="h-7 w-10 rounded border" />
        </div>
      );
    case "spacer":
      return (
        <div className="flex items-center gap-2">
          <label className="text-[11px]">Height (px)</label>
          <input type="number" min={4} max={120} value={block.height ?? 24} onChange={(e) => onChange({ height: Number(e.target.value) })} className="input-base text-xs w-20" />
        </div>
      );
    case "quote":
      return (
        <div className="space-y-1.5">
          <textarea rows={2} value={block.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} placeholder="Quote text" className="input-base text-xs w-full italic" />
          <input value={block.author ?? ""} onChange={(e) => onChange({ author: e.target.value })} placeholder="Author (optional)" className="input-base text-xs w-full" />
        </div>
      );
    case "social":
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(block.links ?? {}).map(([k, v]) => (
            <input
              key={k}
              value={String(v ?? "")}
              onChange={(e) => onChange({ links: { ...(block.links ?? {}), [k]: e.target.value } })}
              placeholder={`${k} URL`}
              className="input-base text-xs"
            />
          ))}
        </div>
      );
    case "html":
      return (
        <textarea
          rows={5}
          value={block.html ?? ""}
          onChange={(e) => onChange({ html: e.target.value })}
          placeholder="<!-- Paste custom HTML — merge fields ({{token}}) are supported -->"
          className="input-base text-xs w-full font-mono"
        />
      );
    default:
      return null;
  }
}

// =============================================================================
// HTML mode
// =============================================================================

function HtmlMode({ html, onChange }: { html: string; onChange: (v: string) => void }) {
  return (
    <div className="card-surface">
      <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <Code className="size-3.5 text-brand-cyan" />
        Paste any HTML — Outlook/Gmail-safe code is recommended. Merge fields like{" "}
        <code className="bg-secondary px-1 rounded">{`{{investor.name}}`}</code> are substituted at send time.
      </div>
      <textarea
        rows={28}
        value={html}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_HTML_TEMPLATE}
        className="w-full p-3 font-mono text-xs bg-white outline-none resize-none"
        spellCheck={false}
      />
    </div>
  );
}

const DEFAULT_HTML_TEMPLATE = `<!-- Custom HTML email - merge fields {{investor.name}} are supported -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;">
      <tr><td style="padding:32px;">
        <h1 style="color:#0e2557;margin:0 0 12px;">Welcome, {{investor.name}}</h1>
        <p>Hi {{investor.first_name}},</p>
        <p>Thank you for choosing {{tenant.displayName}}.</p>
        <p style="margin-top:24px;">
          <a href="{{system.dashboard_url}}" style="background:#0ea5e9;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">
            View dashboard
          </a>
        </p>
        <hr style="margin:24px 0;border:0;border-top:1px solid #e5e7eb;"/>
        <p style="color:#6b7280;font-size:12px;">
          {{tenant.displayName}} · ARN-{{tenant.arn}}<br/>
          Mutual fund investments are subject to market risks.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

// =============================================================================
// Small helpers
// =============================================================================

function ModeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-xs ${active ? "bg-brand-cyan-light text-brand-cyan-deep font-semibold" : "text-muted-foreground hover:bg-secondary/40"}`}
    >
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 rounded border" />
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input-base text-xs flex-1 font-mono" />
      <label className="text-[11px] text-muted-foreground w-20 text-right">{label}</label>
    </div>
  );
}

function SelectInline({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base text-xs">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// =============================================================================
// Factory
// =============================================================================

function mkBlock(type: any, patch: any = {}): EmailBlock {
  const id = uuid();
  const defaults: Record<string, any> = {
    logo: { type: "logo" },
    hero: { type: "hero", title: "Welcome, {{investor.name}}", subtitle: "", imageUrl: "", imageAlt: "", align: "center" },
    heading: { type: "heading", text: "Section heading", level: "h2", align: "left" },
    text: { type: "text", html: "Type your message here. Use the merge field picker to insert variables.", align: "left" },
    button: { type: "button", label: "View dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false },
    image: { type: "image", url: "", alt: "", width: 560, align: "center" },
    image_row: { type: "image_row", items: [{ url: "", alt: "" }, { url: "", alt: "" }] },
    data_table: { type: "data_table", caption: "", rows: [{ label: "Scheme", value: "{{transaction.scheme_name}}" }, { label: "Amount", value: "₹{{transaction.amount}}" }, { label: "Date", value: "{{transaction.transaction_date}}" }] },
    divider: { type: "divider", thickness: 1, color: "#e5e7eb" },
    spacer: { type: "spacer", height: 24 },
    quote: { type: "quote", text: "A great client relationship is built on trust.", author: "" },
    social: { type: "social", links: { website: "", linkedin: "", facebook: "", instagram: "", youtube: "", twitter: "" } },
    html: { type: "html", html: "<!-- Custom HTML — merge fields supported -->" },
  };
  return { id, ...defaults[type], ...patch };
}

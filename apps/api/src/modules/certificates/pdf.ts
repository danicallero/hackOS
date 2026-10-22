import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

/** #1083: what a certificate says, frozen when it was issued. */
export interface CertificateSnapshot {
  name: string;
  surname: string | null;
  eventName: string;
  venue: string | null;
  timezone: string;
  eventStartsAt: string;
  eventEndsAt: string;
  issuerName: string;
  hours: number;
  activities: { name: string; at: string }[];
}

export type CertificateVariant = "participation" | "hours" | "activities";
export type CertificateLocale = "es" | "gl" | "en";

interface Copy {
  title: string;
  by: (issuer: string) => string;
  certifies: string;
  person: (dni: string | null) => { before: string; after: string };
  took: (event: string, venue: string | null, from: string, to: string) => string;
  participation: string;
  hours: (hours: string) => string;
  activities: string;
  closing: string;
  issued: (date: string) => string;
  verify: (url: string, code: string) => string;
}

const COPY: Record<CertificateLocale, Copy> = {
  es: {
    title: "CERTIFICADO DE ASISTENCIA",
    by: (issuer) => `${issuer}, como entidad organizadora,`,
    certifies: "CERTIFICA:",
    person: (dni) => ({ before: "Que ", after: `${dni ? ` con DNI/NIE ${dni}` : ""}, ` }),
    took: (event, venue, from, to) =>
      `ha participado activamente en el evento ${event}${venue ? `, celebrado en ${venue},` : ""} durante los días ${from} al ${to}.`,
    participation:
      "Durante el transcurso del evento, el interesado ha colaborado en el desarrollo de proyectos tecnológicos, asistido a talleres especializados y participado en las dinámicas de innovación propuestas por la organización, completando el programa del evento.",
    hours: (hours) =>
      `Su presencia verificada en el recinto durante el evento ha sido de ${hours} horas.`,
    activities: "Ha asistido a las siguientes actividades:",
    closing: "Y para que así conste a los efectos oportunos, se expide el presente certificado.",
    issued: (date) => `Emitido el ${date}.`,
    verify: (url, code) =>
      `Este documento lo emite la organización y no lleva firma manuscrita. Compruebe su autenticidad en ${url} con el código ${code}.`,
  },
  gl: {
    title: "CERTIFICADO DE ASISTENCIA",
    by: (issuer) => `${issuer}, como entidade organizadora,`,
    certifies: "CERTIFICA:",
    person: (dni) => ({ before: "Que ", after: `${dni ? ` con DNI/NIE ${dni}` : ""}, ` }),
    took: (event, venue, from, to) =>
      `participou activamente no evento ${event}${venue ? `, celebrado en ${venue},` : ""} durante os días ${from} ao ${to}.`,
    participation:
      "Durante o transcurso do evento, o interesado colaborou no desenvolvemento de proxectos tecnolóxicos, asistiu a obradoiros especializados e participou nas dinámicas de innovación propostas pola organización, completando o programa do evento.",
    hours: (hours) =>
      `A súa presenza verificada no recinto durante o evento foi de ${hours} horas.`,
    activities: "Asistiu ás seguintes actividades:",
    closing: "E para que así conste aos efectos oportunos, expídese o presente certificado.",
    issued: (date) => `Emitido o ${date}.`,
    verify: (url, code) =>
      `Este documento emíteo a organización e non leva sinatura manuscrita. Comprobe a súa autenticidade en ${url} co código ${code}.`,
  },
  en: {
    title: "CERTIFICATE OF ATTENDANCE",
    by: (issuer) => `${issuer}, as the organising body,`,
    certifies: "CERTIFIES:",
    person: (dni) => ({ before: "That ", after: `${dni ? `, ID ${dni}` : ""}, ` }),
    took: (event, venue, from, to) =>
      `actively took part in the event ${event}${venue ? `, held at ${venue},` : ""} from ${from} to ${to}.`,
    participation:
      "During the event, the participant collaborated in the development of technology projects, attended specialised workshops and took part in the innovation activities proposed by the organisation, completing the event programme.",
    hours: (hours) => `Their verified presence at the venue during the event was ${hours} hours.`,
    activities: "They attended the following activities:",
    closing: "This certificate is issued for all appropriate purposes.",
    issued: (date) => `Issued on ${date}.`,
    verify: (url, code) =>
      `This document is issued by the organisation and carries no handwritten signature. Verify its authenticity at ${url} with the code ${code}.`,
  },
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 64;
const BLACK = rgb(0.07, 0.07, 0.07);
const GREY = rgb(0.4, 0.4, 0.4);

function formatDate(iso: string, locale: CertificateLocale, timezone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: timezone }).format(
    new Date(iso),
  );
}

/** Hours with at most one decimal, in the reader's number format. */
function formatHours(hours: number, locale: CertificateLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(hours);
}

/** Standard PDF fonts cover Latin-1 only; anything else would make the render throw. */
function printable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text.normalize("NFC")]
    .map((char) => (supported.has(char.codePointAt(0) as number) ? char : "?"))
    .join("");
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface RenderInput {
  snapshot: CertificateSnapshot;
  variant: CertificateVariant;
  locale: CertificateLocale;
  code: string;
  verifyUrl: string;
  issuedAt: Date;
  /** Read live from the account, never stored with the certificate. */
  dni: string | null;
}

/**
 * #1083: the certificate PDF. One A4 page (a second only for a long activity
 * list), issued by the organisation: no personal signature, a QR and a code that
 * the public verification page resolves.
 */
export async function renderCertificatePdf(input: RenderInput): Promise<Uint8Array> {
  const { snapshot, variant, locale, code, verifyUrl, issuedAt, dni } = input;
  const copy = COPY[locale];
  const pdf = await PDFDocument.create();
  pdf.setTitle(copy.title);
  pdf.setProducer("hackOS");
  pdf.setCreationDate(issuedAt);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - MARGIN * 2;
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const ensure = (needed: number) => {
    if (y - needed >= MARGIN) return;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };
  const paragraph = (text: string, font: PDFFont, size: number, gap: number, color = BLACK) => {
    for (const line of wrap(font, printable(font, text), size, width)) {
      ensure(size * 1.5);
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color });
      y -= size * 1.5;
    }
    y -= gap;
  };

  /** A paragraph whose pieces may be bold, wrapped as one flow. */
  const rich = (parts: { text: string; bold?: boolean }[], size: number, gap: number) => {
    const words = parts.flatMap((part) => {
      const font = part.bold ? bold : regular;
      return printable(font, part.text)
        .split(/(?<=\s)/)
        .filter((word) => word.length > 0)
        .map((word) => ({ word, font }));
    });
    let line: typeof words = [];
    let lineWidth = 0;
    const flush = () => {
      ensure(size * 1.5);
      let x = MARGIN;
      for (const { word, font } of line) {
        page.drawText(word, { x, y: y - size, size, font, color: BLACK });
        x += font.widthOfTextAtSize(word, size);
      }
      y -= size * 1.5;
      line = [];
      lineWidth = 0;
    };
    for (const item of words) {
      const w = item.font.widthOfTextAtSize(item.word.trimEnd(), size);
      if (line.length > 0 && lineWidth + w > width) flush();
      line.push(item);
      lineWidth += item.font.widthOfTextAtSize(item.word, size);
    }
    if (line.length > 0) flush();
    y -= gap;
  };

  const from = formatDate(snapshot.eventStartsAt, locale, snapshot.timezone);
  const to = formatDate(snapshot.eventEndsAt, locale, snapshot.timezone);
  const fullName = [snapshot.name, snapshot.surname].filter(Boolean).join(" ");

  // The organisation's logo, when its file is present, top right.
  const logo = await readFile(join(process.cwd(), "assets", "certificate", "logo.png")).catch(
    () => null,
  );
  if (logo) {
    const image = await pdf.embedPng(logo);
    const scaled = image.scale(Math.min(96 / image.width, 96 / image.height));
    page.drawImage(image, {
      x: PAGE.width - MARGIN - scaled.width,
      y: PAGE.height - MARGIN - scaled.height,
      width: scaled.width,
      height: scaled.height,
    });
    y -= scaled.height + 24;
  }

  paragraph(copy.title, bold, 16, 18);
  paragraph(copy.by(snapshot.issuerName), regular, 12, 18);
  paragraph(copy.certifies, bold, 12, 14);
  const person = copy.person(dni);
  rich(
    [
      { text: person.before },
      { text: fullName, bold: true },
      { text: `${person.after}${copy.took(snapshot.eventName, snapshot.venue, from, to)}` },
    ],
    12,
    14,
  );

  if (variant === "participation") paragraph(copy.participation, regular, 12, 14);
  if (variant === "hours") {
    paragraph(copy.participation, regular, 12, 10);
    paragraph(copy.hours(formatHours(snapshot.hours, locale)), bold, 12, 14);
  }
  if (variant === "activities") {
    paragraph(copy.activities, bold, 12, 6);
    for (const activity of snapshot.activities) {
      const date = formatDate(activity.at, locale, snapshot.timezone);
      paragraph(`- ${activity.name} (${date})`, regular, 11, 0);
    }
    y -= 12;
  }

  paragraph(copy.closing, regular, 12, 8);
  paragraph(
    copy.issued(formatDate(issuedAt.toISOString(), locale, snapshot.timezone)),
    regular,
    12,
    22,
  );

  // Verification block: QR on the left, how to check it beside it.
  const qr = await pdf.embedPng(
    await QRCode.toBuffer(verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" }),
  );
  const qrSize = 84;
  ensure(qrSize + 24);
  page.drawImage(qr, { x: MARGIN, y: y - qrSize, width: qrSize, height: qrSize });
  const textX = MARGIN + qrSize + 14;
  const verifyLines = wrap(
    regular,
    printable(regular, copy.verify(verifyUrl, code)),
    9,
    PAGE.width - MARGIN - textX,
  );
  let lineY = y - 12;
  for (const line of verifyLines) {
    page.drawText(line, { x: textX, y: lineY, size: 9, font: regular, color: GREY });
    lineY -= 13;
  }
  return pdf.save();
}

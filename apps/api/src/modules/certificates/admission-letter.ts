import type { CertificateLocale } from "./pdf.js";

export const ADMISSION_LETTER = {
  gl: {
    title: "Carta de convite e certificado de admisión — HackUDC 2027",
    date: "Data de emisión",
    verificationCode: "Código de verificación (CSV)",
    greeting: "A quen corresponda:",
    identification: "número de identificación",
    invitation: (issuer: string, taxId: string, recipient: string) =>
      `A ${issuer}${taxId ? `, con número de identificación fiscal español ${taxId},` : ""} convida a ${recipient} a participar en HackUDC 2027 e confirma a súa admisión no evento.`,
    venue:
      "HackUDC 2027 terá lugar do 26 ao 28 de febreiro de 2027 na Facultade de Informática da Universidade da Coruña, no Campus de Elviña, na Coruña, España.",
    event:
      "HackUDC é un hackatón de código aberto de 36 horas organizado por GPUL, unha asociación universitaria sen ánimo de lucro. As persoas participantes traballan en equipo para resolver retos, desenvolver proxectos de código aberto e presentar o seu traballo ao remate do evento.",
    provisions:
      "GPUL proporcionará comida de balde á persoa convidada durante o evento. As persoas participantes tamén terán á súa disposición unha zona de descanso habilitada no recinto.",
    confirmation: "Este documento acredita o convite e a admisión en HackUDC 2027.",
    contact:
      "Para obter máis información sobre o evento, visite https://hackudc.com/gl/. Para consultas sobre este convite, escriba a hackudc@gpul.org.",
    issued: (issuer: string) => `Emitido electronicamente pola ${issuer}.`,
  },
  es: {
    title: "Carta de invitación y certificado de admisión — HackUDC 2027",
    date: "Fecha de emisión",
    verificationCode: "Código de verificación (CSV)",
    greeting: "A quien corresponda:",
    identification: "número de identificación",
    invitation: (issuer: string, taxId: string, recipient: string) =>
      `La ${issuer}${taxId ? `, con número de identificación fiscal español ${taxId},` : ""} invita a ${recipient} a participar en HackUDC 2027 y confirma su admisión en el evento.`,
    venue:
      "HackUDC 2027 se celebrará del 26 al 28 de febrero de 2027 en la Facultade de Informática de la Universidade da Coruña, en el Campus de Elviña, A Coruña, España.",
    event:
      "HackUDC es un hackatón de código abierto de 36 horas organizado por GPUL, una asociación universitaria sin ánimo de lucro. Las personas participantes trabajan en equipo para resolver retos, desarrollar proyectos de código abierto y presentar su trabajo al final del evento.",
    provisions:
      "GPUL proporcionará comidas gratuitas a la persona invitada durante el evento. Las personas participantes también tendrán a su disposición una zona de descanso habilitada en el recinto.",
    confirmation: "Este documento acredita la invitación y la admisión en HackUDC 2027.",
    contact:
      "Para obtener más información sobre el evento, visite https://hackudc.com/. Para consultas sobre esta invitación, escriba a hackudc@gpul.org.",
    issued: (issuer: string) => `Emitido electrónicamente por la ${issuer}.`,
  },
  en: {
    title: "Invitation Letter and Certificate of Admission — HackUDC 2027",
    date: "Date of issue",
    verificationCode: "Verification code (CSV)",
    greeting: "To Whom It May Concern:",
    identification: "identification number",
    invitation: (issuer: string, taxId: string, recipient: string) =>
      `The ${issuer}${taxId ? `, Spanish tax identification number ${taxId},` : ""} hereby invites ${recipient} to participate in HackUDC 2027 and confirms their admission to the event.`,
    venue:
      "HackUDC 2027 will take place from 26 to 28 February 2027 at the Facultade de Informática, Universidade da Coruña, Campus de Elviña, A Coruña, Spain.",
    event:
      "HackUDC is a 36-hour open-source hackathon organised by GPUL, a nonprofit university association. Participants work in teams to tackle challenges, develop open-source projects and present their work at the end of the event.",
    provisions:
      "GPUL will provide meals free of charge to the invited participant during the event. Participants will also have access to a designated rest area at the venue during the event.",
    confirmation: "This document confirms the invitation and admission to HackUDC 2027.",
    contact:
      "For more information about the event, visit https://hackudc.com/en/. For enquiries about this invitation, contact hackudc@gpul.org.",
    issued: (issuer: string) => `Electronically issued by the ${issuer}.`,
  },
} satisfies Record<CertificateLocale, unknown>;

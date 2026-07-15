"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import { useMe } from "./session";
import type { Language } from "./types";

/** i18n label as stored by the API (plan/07 §2): all three locales. */
export interface I18nText {
  en: string;
  es: string;
  gl: string;
}

export const LANGS: Language[] = ["es", "gl", "en"];

export const LOCALE_CODES: Record<Language, string> = {
  es: "es-ES",
  gl: "gl-ES",
  en: "en-GB",
};

const STORAGE_KEY = "hackos-language";

export function isLanguage(value: string | null | undefined): value is Language {
  return !!value && LANGS.includes(value as Language);
}

export function languageName(language: Language): string {
  return { es: "Castellano", gl: "Galego", en: "English" }[language];
}

export type MessageKey = string;
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * All UI strings, grouped by feature area so a key and its es/gl/en variants
 * always sit together. Add new keys to the section they belong to (or start a
 * new "// ---- Section ----" group); keep the three languages in sync.
 */
const dict: Record<string, I18nText> = {
  // ---- Navigation & sidebar ----
  dashboard: { es: "Inicio", gl: "Inicio", en: "Dashboard" },
  myApplications: { es: "Mis solicitudes", gl: "As miñas solicitudes", en: "My applications" },
  myQueue: { es: "Mi cola", gl: "A miña cola", en: "My queue" },
  operations: { es: "Operaciones", gl: "Operacións", en: "Operations" },
  queueOperations: { es: "Gestión de colas", gl: "Xestión de colas", en: "Queue operations" },
  accreditation: { es: "Acreditación", gl: "Acreditación", en: "Accreditation" },
  meals: { es: "Comidas", gl: "Comidas", en: "Meals" },
  activities: { es: "Actividades", gl: "Actividades", en: "Activities" },
  presence: { es: "Presencia", gl: "Presenza", en: "Presence" },
  logisticsStats: {
    es: "Estadísticas de logística",
    gl: "Estatísticas de loxística",
    en: "Logistics stats",
  },
  administration: { es: "Administración", gl: "Administración", en: "Administration" },
  judging: { es: "Evaluación", gl: "Avaliación", en: "Judging" },
  projects: { es: "Proyectos", gl: "Proxectos", en: "Projects" },
  applications: { es: "Solicitudes", gl: "Solicitudes", en: "Applications" },
  schedule: { es: "Programa", gl: "Programa", en: "Schedule" },
  announcements: { es: "Avisos", gl: "Avisos", en: "Announcements" },
  enterprises: { es: "Empresas", gl: "Empresas", en: "Enterprises" },
  challenges: { es: "Retos", gl: "Retos", en: "Challenges" },
  users: { es: "Usuarios", gl: "Usuarios", en: "Users" },
  permissions: { es: "Permisos", gl: "Permisos", en: "Permissions" },
  eventSettings: {
    es: "Configuración del evento",
    gl: "Configuración do evento",
    en: "Event settings",
  },
  tvControl: { es: "Control de TV", gl: "Control de TV", en: "TV control" },
  rooms: { es: "Salas", gl: "Salas", en: "Rooms" },
  libraries: { es: "Catálogos", gl: "Catálogos", en: "Libraries" },
  auditLog: { es: "Registro de auditoría", gl: "Rexistro de auditoría", en: "Audit log" },
  account: { es: "Cuenta", gl: "Conta", en: "Account" },
  inbox: { es: "Bandeja de entrada", gl: "Caixa de entrada", en: "Inbox" },
  wallet: { es: "Cartera", gl: "Carteira", en: "Wallet" },
  myProfile: { es: "Mi perfil", gl: "O meu perfil", en: "My profile" },
  soon: { es: "Próximamente", gl: "Próximamente", en: "Soon" },
  comingSoon: { es: "próximamente", gl: "próximamente", en: "coming soon" },
  profile: { es: "Mi perfil", gl: "O meu perfil", en: "My profile" },
  signOut: { es: "Cerrar sesión", gl: "Pechar sesión", en: "Sign out" },

  // ---- Theme switcher ----
  light: { es: "Claro", gl: "Claro", en: "Light" },
  dark: { es: "Oscuro", gl: "Escuro", en: "Dark" },
  system: { es: "Sistema", gl: "Sistema", en: "System" },
  toggleTheme: { es: "Cambiar tema", gl: "Cambiar tema", en: "Toggle theme" },

  // ---- Sign in / sign up ----
  welcomeBack: { es: "Te damos la bienvenida", gl: "Benvida de novo", en: "Welcome back" },
  signInDescription: {
    es: "Inicia sesión en hackOS.",
    gl: "Inicia sesión en hackOS.",
    en: "Sign in to hackOS.",
  },
  email: { es: "Correo electrónico", gl: "Correo electrónico", en: "Email" },
  password: { es: "Contraseña", gl: "Contrasinal", en: "Password" },
  forgotPassword: {
    es: "¿Has olvidado la contraseña?",
    gl: "Esqueciches o contrasinal?",
    en: "Forgot password?",
  },
  signIn: { es: "Iniciar sesión", gl: "Iniciar sesión", en: "Sign in" },
  newToHackos: { es: "¿Aún no tienes cuenta?", gl: "Aínda non tes conta?", en: "New to hackOS?" },
  createAccount: { es: "Crear una cuenta", gl: "Crear unha conta", en: "Create an account" },
  incorrectCredentials: {
    es: "El correo o la contraseña no son correctos.",
    gl: "O correo ou o contrasinal non son correctos.",
    en: "Incorrect email or password.",
  },
  couldNotSignIn: {
    es: "No se ha podido iniciar sesión. Inténtalo de nuevo.",
    gl: "Non se puido iniciar sesión. Téntao de novo.",
    en: "Could not sign in. Please try again.",
  },
  validEmail: {
    es: "Introduce un correo válido",
    gl: "Introduce un correo válido",
    en: "Enter a valid email",
  },
  required: { es: "Obligatorio", gl: "Obrigatorio", en: "Required" },
  createYourAccount: { es: "Crea tu cuenta", gl: "Crea a túa conta", en: "Create your account" },
  signUpDescription: {
    es: "Regístrate con tu nombre, correo y contraseña.",
    gl: "Rexístrate co teu nome, correo e contrasinal.",
    en: "Sign up with your name, email and password.",
  },
  name: { es: "Nombre", gl: "Nome", en: "Name" },
  surname: { es: "Apellidos", gl: "Apelidos", en: "Surname" },
  language: { es: "Idioma", gl: "Idioma", en: "Language" },
  alreadyHaveAccount: {
    es: "¿Ya tienes cuenta?",
    gl: "Xa tes conta?",
    en: "Already have an account?",
  },
  checkInbox: { es: "Revisa tu correo", gl: "Revisa o teu correo", en: "Check your inbox" },
  verificationSent: {
    es: "Hemos enviado un código de verificación a {email}.",
    gl: "Enviamos un código de verificación a {email}.",
    en: "We sent a verification code to {email}.",
  },
  resendVerification: {
    es: "Reenviar verificación",
    gl: "Reenviar verificación",
    en: "Resend verification",
  },
  didntGetIt: { es: "¿No lo has recibido?", gl: "Non o recibiches?", en: "Didn't get it?" },
  couldNotCreateAccount: {
    es: "No se ha podido crear la cuenta.",
    gl: "Non se puido crear a conta.",
    en: "Could not create the account.",
  },
  atLeastEight: {
    es: "Al menos 8 caracteres",
    gl: "Polo menos 8 caracteres",
    en: "At least 8 characters",
  },

  // ---- Profile: personal details ----
  personalDetails: { es: "Datos personales", gl: "Datos persoais", en: "Personal details" },
  firstName: { es: "Nombre", gl: "Nome", en: "First name" },
  lastName: { es: "Apellidos", gl: "Apelidos", en: "Last name" },
  phone: { es: "Teléfono", gl: "Teléfono", en: "Phone" },
  shirtSize: { es: "Talla de camiseta", gl: "Talla de camiseta", en: "Shirt size" },
  notSet: { es: "Sin indicar", gl: "Sen indicar", en: "Not set" },
  foodIntolerances: {
    es: "Intolerancias alimentarias",
    gl: "Intolerancias alimentarias",
    en: "Food intolerances",
  },
  otherDietaryNotes: {
    es: "Otras notas dietéticas",
    gl: "Outras notas dietéticas",
    en: "Other dietary notes",
  },
  saveChanges: { es: "Guardar cambios", gl: "Gardar cambios", en: "Save changes" },
  profileUpdated: { es: "Perfil actualizado.", gl: "Perfil actualizado.", en: "Profile updated." },
  couldNotSaveProfile: {
    es: "No se ha podido guardar el perfil.",
    gl: "Non se puido gardar o perfil.",
    en: "Could not save your profile.",
  },
  selectIntolerances: {
    es: "Selecciona las que correspondan…",
    gl: "Selecciona as que correspondan…",
    en: "Select any that apply…",
  },
  searchIntolerances: {
    es: "Buscar intolerancias…",
    gl: "Buscar intolerancias…",
    en: "Search intolerances…",
  },
  noIntolerances: {
    es: "Aún no hay intolerancias en el catálogo.",
    gl: "Aínda non hai intolerancias no catálogo.",
    en: "No intolerances in the dictionary yet.",
  },
  cateringNotes: {
    es: "Indica cualquier necesidad adicional para el equipo de catering.",
    gl: "Indica calquera necesidade adicional para o equipo de catering.",
    en: "Anything else catering should know…",
  },

  // ---- Public marketing pages ----
  logIn: { es: "Iniciar sesión", gl: "Iniciar sesión", en: "Log in" },
  termsAndConditions: {
    es: "Términos y condiciones",
    gl: "Termos e condicións",
    en: "Terms and conditions",
  },
  privacyPolicy: {
    es: "Política de privacidad",
    gl: "Política de privacidade",
    en: "Privacy policy",
  },
  legalInformation: {
    es: "Información legal",
    gl: "Información legal",
    en: "Legal information",
  },
  backHome: { es: "Volver al inicio", gl: "Volver ao inicio", en: "Back to home" },
  lastUpdated: {
    es: "Última actualización",
    gl: "Última actualización",
    en: "Last updated",
  },
  legalLinksLabel: {
    es: "Enlaces legales",
    gl: "Ligazóns legais",
    en: "Legal links",
  },
  signUpLegalPrefix: {
    es: "Al crear una cuenta, aceptas los",
    gl: "Ao crear unha conta, aceptas os",
    en: "By creating an account, you agree to the",
  },
  signUpLegalJoin: { es: "y la", gl: "e a", en: "and" },
  applyNow: { es: "Solicitar plaza", gl: "Solicitar praza", en: "Apply now" },
  apply: { es: "Solicitar", gl: "Solicitar", en: "Apply" },
  openApplications: {
    es: "Solicitudes abiertas",
    gl: "Solicitudes abertas",
    en: "Open applications",
  },
  closes: { es: "cierra", gl: "pecha", en: "closes" },
  publicAnnouncements: { es: "Avisos", gl: "Avisos", en: "Announcements" },
  publicSchedule: { es: "Programa", gl: "Programa", en: "Schedule" },
  schedulePending: {
    es: "El programa se publicará próximamente.",
    gl: "O programa publicarase proximamente.",
    en: "The schedule will be published soon.",
  },
  challengesAndPrizes: {
    es: "Retos y premios",
    gl: "Retos e premios",
    en: "Challenges and prizes",
  },
  prizesAvailable: { es: "Hay premios", gl: "Hai premios", en: "Prizes available" },
  challengesPending: {
    es: "Los retos se publicarán próximamente.",
    gl: "Os retos publicaranse proximamente.",
    en: "Challenges will be published soon.",
  },
  sponsors: { es: "Patrocinadores", gl: "Patrocinadores", en: "Sponsors" },
  sponsorsPending: {
    es: "Los patrocinadores se anunciarán próximamente.",
    gl: "Os patrocinadores anunciaranse proximamente.",
    en: "Sponsors will be announced soon.",
  },

  // ---- Password reset & email verification ----
  checkEmail: { es: "Revisa tu correo", gl: "Revisa o teu correo", en: "Check your email" },
  resetPassword: {
    es: "Restablece la contraseña",
    gl: "Restablece o contrasinal",
    en: "Reset your password",
  },
  sendResetLink: { es: "Enviar enlace", gl: "Enviar ligazón", en: "Send reset link" },
  backToSignIn: {
    es: "Volver al inicio de sesión",
    gl: "Volver ao inicio de sesión",
    en: "Back to sign in",
  },
  rememberedIt: { es: "¿La recuerdas?", gl: "Lembrácheste?", en: "Remembered it?" },
  resetEmailSent: {
    es: "Si existe una cuenta con esa dirección, hemos enviado un enlace para restablecer la contraseña.",
    gl: "Se existe unha conta con ese enderezo, enviamos unha ligazón para restablecer o contrasinal.",
    en: "If an account exists for that address, we've sent a link to reset your password.",
  },
  setNewPassword: {
    es: "Establece una contraseña nueva",
    gl: "Establece un contrasinal novo",
    en: "Set a new password",
  },
  newPassword: { es: "Nueva contraseña", gl: "Novo contrasinal", en: "New password" },
  confirmPassword: {
    es: "Confirmar contraseña",
    gl: "Confirmar contrasinal",
    en: "Confirm password",
  },
  updatePassword: {
    es: "Actualizar contraseña",
    gl: "Actualizar contrasinal",
    en: "Update password",
  },
  resetTokenMissing: {
    es: "Falta el token de restablecimiento o no es válido.",
    gl: "Falta o token de restablecemento ou non é válido.",
    en: "Missing or invalid reset token.",
  },
  resetLinkInvalid: {
    es: "Este enlace no es válido o ha caducado.",
    gl: "Esta ligazón non é válida ou caducou.",
    en: "This reset link is invalid or has expired.",
  },
  passwordsDontMatch: {
    es: "Las contraseñas no coinciden",
    gl: "Os contrasinais non coinciden",
    en: "Passwords don't match",
  },
  passwordUpdated: {
    es: "Contraseña actualizada. Inicia sesión.",
    gl: "Contrasinal actualizado. Inicia sesión.",
    en: "Password updated. Please sign in.",
  },
  emailVerified: { es: "Correo verificado", gl: "Correo verificado", en: "Email verified" },
  emailVerifiedDescription: {
    es: "Tu dirección está confirmada y ya has iniciado sesión.",
    gl: "O teu enderezo está confirmado e xa iniciaches sesión.",
    en: "Your address is confirmed and you're signed in.",
  },
  continueToDashboard: { es: "Ir al inicio", gl: "Ir ao inicio", en: "Continue to dashboard" },
  differentAccount: {
    es: "Iniciar sesión con otra cuenta",
    gl: "Iniciar sesión con outra conta",
    en: "Sign in with a different account",
  },
  verifyEmail: { es: "Verifica tu correo", gl: "Verifica o teu correo", en: "Verify your email" },
  verificationInstructions: {
    es: "Sigue el enlace que te enviamos por correo. Si no lo encuentras, puedes reenviarlo.",
    gl: "Segue a ligazón que che enviamos por correo. Se non a atopas, podes reenviala.",
    en: "Follow the link we emailed you. Didn't get it? Resend below.",
  },
  resendVerificationEmail: {
    es: "Reenviar correo de verificación",
    gl: "Reenviar correo de verificación",
    en: "Resend verification email",
  },
  verificationEmailSent: {
    es: "Correo de verificación enviado. Revisa tu bandeja de entrada.",
    gl: "Correo de verificación enviado. Revisa a túa caixa de entrada.",
    en: "Verification email sent. Check your inbox.",
  },
  couldNotSendEmail: {
    es: "No se ha podido enviar el correo.",
    gl: "Non se puido enviar o correo.",
    en: "Could not send the email.",
  },
  resendIn: {
    es: "Reenviar en {seconds}s",
    gl: "Reenviar en {seconds}s",
    en: "Resend in {seconds}s",
  },
  confirmingPlace: {
    es: "Confirmando tu plaza…",
    gl: "Confirmando a túa praza…",
    en: "Confirming your place…",
  },
  releasingPlace: {
    es: "Liberando tu plaza…",
    gl: "Liberando a túa praza…",
    en: "Releasing your spot…",
  },
  viewApplications: {
    es: "Ver mis solicitudes",
    gl: "Ver as miñas solicitudes",
    en: "View my applications",
  },
  goToApplications: {
    es: "Ir a mis solicitudes",
    gl: "Ir ás miñas solicitudes",
    en: "Go to my applications",
  },
  confirmationFailed: {
    es: "No se ha podido confirmar tu plaza",
    gl: "Non se puido confirmar a túa praza",
    en: "We couldn't confirm your place",
  },
  placeConfirmed: { es: "Plaza confirmada", gl: "Praza confirmada", en: "Your place is confirmed" },
  alreadyConfirmed: {
    es: "Ya has confirmado tu plaza",
    gl: "Xa confirmaches a túa praza",
    en: "You're already confirmed",
  },
  declineFailed: {
    es: "No se ha podido procesar el enlace",
    gl: "Non se puido procesar a ligazón",
    en: "We couldn't process this link",
  },
  placeReleased: { es: "Plaza liberada", gl: "Praza liberada", en: "Spot released" },
  alreadyReleased: {
    es: "Tu plaza ya estaba liberada",
    gl: "A túa praza xa estaba liberada",
    en: "Your spot was already released",
  },
  linkMissingToken: {
    es: "A este enlace le falta el token.",
    gl: "A esta ligazón fáltalle o token.",
    en: "This link is missing its token.",
  },
  showPassword: { es: "Mostrar contraseña", gl: "Mostrar contrasinal", en: "Show password" },
  hidePassword: { es: "Ocultar contraseña", gl: "Ocultar contrasinal", en: "Hide password" },
  clearDate: { es: "Borrar fecha", gl: "Borrar data", en: "Clear date" },
  languageLabel: { es: "Idioma", gl: "Idioma", en: "Language" },

  // ---- File uploads & Devpost tag picker ----
  devpostTags: { es: "Etiquetas de Devpost", gl: "Etiquetas de Devpost", en: "Devpost tags" },
  selectDevpostTags: {
    es: "Selecciona etiquetas de Devpost",
    gl: "Selecciona etiquetas de Devpost",
    en: "Select Devpost tags",
  },
  searchImportedPrizes: {
    es: "Buscar premios importados…",
    gl: "Buscar premios importados…",
    en: "Search imported prizes…",
  },
  noImportedPrizes: {
    es: "Aún no hay premios importados.",
    gl: "Aínda non hai premios importados.",
    en: "No imported prizes yet.",
  },
  copied: { es: "Copiado.", gl: "Copiado.", en: "Copied." },
  copy: { es: "Copiar", gl: "Copiar", en: "Copy" },
  chooseFile: { es: "Elegir archivo", gl: "Escoller ficheiro", en: "Choose file" },
  uploading: { es: "Subiendo…", gl: "Subindo…", en: "Uploading…" },
  removeFile: { es: "Quitar archivo", gl: "Quitar ficheiro", en: "Remove file" },
  anyFile: { es: "Cualquier archivo", gl: "Calquera ficheiro", en: "Any file" },
  uploadFailed: {
    es: "No se ha podido subir el archivo.",
    gl: "Non se puido subir o ficheiro.",
    en: "Could not upload the file.",
  },
  fileUploaded: { es: "Archivo subido.", gl: "Ficheiro subido.", en: "File uploaded." },

  // ---- Invite acceptance ----
  inviteUnavailable: {
    es: "Invitación no disponible",
    gl: "Invitación non dispoñible",
    en: "Invite unavailable",
  },
  accountCreated: { es: "Cuenta creada", gl: "Conta creada", en: "Account created" },

  // ---- Secondary email verification ----
  verifyNow: { es: "Verificar ahora", gl: "Verificar agora", en: "Verify now" },
  emailNotVerified: {
    es: "Tu correo todavía no está verificado.",
    gl: "O teu correo aínda non está verificado.",
    en: "Your email isn't verified yet.",
  },
  secondaryEmailVerified: {
    es: "Correo secundario verificado",
    gl: "Correo secundario verificado",
    en: "Secondary email verified",
  },
  verifyingSecondaryEmail: {
    es: "Verificando correo secundario…",
    gl: "Verificando correo secundario…",
    en: "Verifying your secondary email…",
  },
  backToProfile: { es: "Volver al perfil", gl: "Volver ao perfil", en: "Back to profile" },
  verificationFailed: {
    es: "No se ha podido verificar.",
    gl: "Non se puido verificar.",
    en: "Couldn't verify.",
  },

  // ---- Account overview & capabilities ----
  accountRole: { es: "Rol", gl: "Rol", en: "Account role" },
  capabilities: { es: "Permisos", gl: "Permisos", en: "Capabilities" },
  verified: { es: "Verificado", gl: "Verificado", en: "Verified" },
  unverified: { es: "Sin verificar", gl: "Sen verificar", en: "Unverified" },
  yourCapabilities: { es: "Tus permisos", gl: "Os teus permisos", en: "Your capabilities" },
  welcome: { es: "Bienvenido", gl: "Benvida", en: "Welcome" },
  dashboardDescription: {
    es: "Consulta lo importante del evento de un vistazo.",
    gl: "Consulta o importante do evento dunha ollada.",
    en: "See what matters for the event at a glance.",
  },
  loadingDashboard: { es: "Cargando inicio", gl: "Cargando inicio", en: "Loading dashboard" },
  eventStatus: { es: "Estado del evento", gl: "Estado do evento", en: "Event status" },
  eventTimingPending: {
    es: "El horario del evento se publicará próximamente.",
    gl: "O horario do evento publicarase proximamente.",
    en: "Event timing will be published soon.",
  },
  nextUp: { es: "Lo próximo", gl: "O seguinte", en: "Next up" },
  nextUpDescription: {
    es: "La siguiente actividad del programa.",
    gl: "A seguinte actividade do programa.",
    en: "The next activity on the schedule.",
  },
  noUpcomingSchedule: {
    es: "No hay más actividades programadas.",
    gl: "Non hai máis actividades programadas.",
    en: "There are no more scheduled activities.",
  },
  latestAnnouncements: { es: "Últimos avisos", gl: "Últimos avisos", en: "Latest announcements" },
  yourStatus: { es: "Tu estado", gl: "O teu estado", en: "Your status" },
  viewAll: { es: "Ver todo", gl: "Ver todo", en: "View all" },
  viewSchedule: { es: "Ver programa", gl: "Ver programa", en: "View schedule" },
  viewQueue: { es: "Ver mi cola", gl: "Ver a miña cola", en: "View my queue" },

  // ---- Entrance ticket & wallet badge ----
  entranceTicket: { es: "Entrada", gl: "Entrada", en: "Entrance ticket" },
  badge: { es: "Acreditación", gl: "Acreditación", en: "Badge" },
  qrCodes: { es: "Códigos QR", gl: "Códigos QR", en: "QR codes" },
  availableAfterConfirmation: {
    es: "Disponible tras confirmar",
    gl: "Dispoñible tras confirmar",
    en: "Available after confirmation",
  },
  badgeNotAssigned: {
    es: "Acreditación sin asignar",
    gl: "Acreditación sen asignar",
    en: "Badge not assigned",
  },
  addToAppleWallet: {
    es: "Añadir a Apple Wallet",
    gl: "Engadir a Apple Wallet",
    en: "Add to Apple Wallet",
  },
  currentBadge: { es: "Acreditación actual", gl: "Acreditación actual", en: "Current badge" },

  // ---- Date/time picker controls ----
  noDateTime: { es: "Sin fecha ni hora", gl: "Sen data nin hora", en: "No date/time set" },
  addRevealTime: {
    es: "Añadir hora de publicación",
    gl: "Engadir hora de publicación",
    en: "Add reveal time",
  },
  edit: { es: "Editar", gl: "Editar", en: "Edit" },
  clear: { es: "Borrar", gl: "Borrar", en: "Clear" },
  dateAndTime: { es: "Fecha y hora", gl: "Data e hora", en: "Date and time" },
  confirm: { es: "Confirmar", gl: "Confirmar", en: "Confirm" },

  // ---- Dialog close button ----
  close: { es: "Cerrar", gl: "Pechar", en: "Close" },

  // ---- Sidebar toggle ----
  toggleSidebar: {
    es: "Alternar barra lateral",
    gl: "Alternar barra lateral",
    en: "Toggle sidebar",
  },

  // ---- Data table selection ----
  selectAll: { es: "Seleccionar todo", gl: "Seleccionar todo", en: "Select all" },
  selectRow: { es: "Seleccionar fila", gl: "Seleccionar fila", en: "Select row" },
  nothingToShow: {
    es: "No hay nada que mostrar",
    gl: "Non hai nada que mostrar",
    en: "Nothing to show",
  },

  // ---- Participant queue status banner ----
  anyMoment: { es: "en cualquier momento", gl: "en calquera momento", en: "any moment now" },
  yourRoom: { es: "tu sala", gl: "a túa sala", en: "your room" },
  queueLoadError: {
    es: "No se ha podido cargar tu estado de cola.",
    gl: "Non se puido cargar o teu estado de cola.",
    en: "Could not load your queue status.",
  },
  yourTurn: {
    es: "Te toca — ve a {room}",
    gl: "É a túa quenda — vai a {room}",
    en: "It's your turn — head to {room}",
  },
  getReady: {
    es: "Prepárate — te toca pronto",
    gl: "Prepárate — tócache pronto",
    en: "Get ready — you're up soon",
  },

  // ---- Participant: my queues ----
  yourQueues: { es: "Tus colas", gl: "As túas colas", en: "Your queues" },
  noJudgingQueue: {
    es: "No estás en ninguna cola de evaluación",
    gl: "Non estás en ningunha cola de avaliación",
    en: "You're not in any judging queue",
  },
  position: { es: "Posición", gl: "Posición", en: "Position" },

  // ---- Inbox tabs ----
  messages: { es: "Mensajes", gl: "Mensaxes", en: "Messages" },
  preferences: { es: "Preferencias", gl: "Preferencias", en: "Preferences" },

  // ---- Notifications & reminders ----
  unreadOnly: { es: "Solo sin leer", gl: "Só sen ler", en: "Unread only" },
  markRead: { es: "Marcar como leído", gl: "Marcar como lido", en: "Mark read" },
  previous: { es: "Anterior", gl: "Anterior", en: "Previous" },
  next: { es: "Siguiente", gl: "Seguinte", en: "Next" },
  notificationChannels: {
    es: "Canales de notificación",
    gl: "Canles de notificación",
    en: "Notification channels",
  },
  activityReminders: {
    es: "Recordatorios de actividades",
    gl: "Recordatorios de actividades",
    en: "Activity reminders",
  },
  addReminder: { es: "Añadir recordatorio", gl: "Engadir recordatorio", en: "Add reminder" },
  chooseActivity: {
    es: "Elige una actividad…",
    gl: "Escolle unha actividade…",
    en: "Choose an activity…",
  },
  category: { es: "Categoría", gl: "Categoría", en: "Category" },
  alwaysOn: { es: "siempre activo", gl: "sempre activo", en: "always on" },
  turnOff: { es: "Desactivar", gl: "Desactivar", en: "Turn off" },

  // ---- Application form settings ----
  formSettings: {
    es: "Configuración del formulario",
    gl: "Configuración do formulario",
    en: "Form settings",
  },
  saveSettings: { es: "Guardar configuración", gl: "Gardar configuración", en: "Save settings" },
  formUpdated: { es: "Formulario actualizado", gl: "Formulario actualizado", en: "Form updated" },
  couldNotSaveForm: {
    es: "No se ha podido guardar el formulario.",
    gl: "Non se puido gardar o formulario.",
    en: "Could not save the form.",
  },

  // ---- Application form questions ----
  questions: { es: "Preguntas", gl: "Preguntas", en: "Questions" },
  questionsSaved: { es: "Preguntas guardadas", gl: "Preguntas gardadas", en: "Questions saved" },
  couldNotSaveQuestions: {
    es: "No se han podido guardar las preguntas.",
    gl: "Non se puideron gardar as preguntas.",
    en: "Could not save the questions.",
  },

  // ---- File upload validation errors ----
  fileTypeNotAllowed: {
    es: "El tipo {ext} no está permitido. Permitidos: {allowed}",
    gl: "O tipo {ext} non está permitido. Permitidos: {allowed}",
    en: "File type {ext} isn't allowed. Allowed: {allowed}",
  },
  fileTooLarge: {
    es: "El archivo supera el límite de {maxMb} MB.",
    gl: "O ficheiro supera o límite de {maxMb} MB.",
    en: "File exceeds the {maxMb} MB limit.",
  },

  // ---- Staff: queue operations ----
  noAccessQueueOps: {
    es: "No tienes acceso a operaciones de cola",
    gl: "Non tes acceso a operacións de cola",
    en: "You can't access queue operations",
  },
  queueOpsAccessDeniedDesc: {
    es: "Necesitas acceso a colas o evaluación.",
    gl: "Necesitas acceso a colas ou avaliación.",
    en: "Queue operations requires queue or judging access.",
  },
  couldNotLoadOperationsDetails: {
    es: "No se han podido cargar los detalles de operaciones.",
    gl: "Non se puideron cargar os detalles de operacións.",
    en: "Could not load operations details.",
  },
  couldNotGenerateQueues: {
    es: "No se han podido generar las colas.",
    gl: "Non se puideron xerar as colas.",
    en: "Could not generate queues.",
  },
  queuesGenerated: {
    es: "Se generaron {inserted} entradas de cola en {challenges} retos.",
    gl: "Xeráronse {inserted} entradas de cola en {challenges} retos.",
    en: "Generated {inserted} queue entries across {challenges} challenges.",
  },
  generateQueues: { es: "Generar colas", gl: "Xerar colas", en: "Generate queues" },
  openJudging: { es: "Abrir evaluación", gl: "Abrir avaliación", en: "Open judging" },
  couldNotLoadQueueOps: {
    es: "No se han podido cargar las operaciones de cola",
    gl: "Non se puideron cargar as operacións de cola",
    en: "Could not load queue operations",
  },
  tryAgain: { es: "Inténtalo de nuevo.", gl: "Téntao de novo.", en: "Try again." },
  roomQueues: { es: "Colas de sala", gl: "Colas de sala", en: "Room queues" },
  roomQueuesDescription: {
    es: "Equipos presentando, equipos llamados, siguiente en la cola y acciones rápidas.",
    gl: "Equipos presentando, equipos chamados, seguinte na cola e accións rápidas.",
    en: "Presenting teams, called teams, next queue head, and fast operator actions.",
  },
  noRoomsYet: { es: "Aún no hay salas", gl: "Aínda non hai salas", en: "No rooms yet" },
  noRoomsYetDescription: {
    es: "Crea salas en Administración para empezar a construir las vistas de cola.",
    gl: "Crea salas en Administración para comezar a construír as vistas de cola.",
    en: "Create rooms in Administration to start building queue views.",
  },
  teamSearchFailed: {
    es: "La búsqueda de equipos ha fallado.",
    gl: "A busca de equipos fallou.",
    en: "Team search failed.",
  },
  queueActionFailed: {
    es: "La acción de cola ha fallado.",
    gl: "A acción de cola fallou.",
    en: "Queue action failed.",
  },
  challengeFallback: { es: "Reto", gl: "Reto", en: "Challenge" },
  paused: { es: "Pausada", gl: "Pausada", en: "Paused" },
  live: { es: "En directo", gl: "En directo", en: "Live" },
  noLocation: { es: "Sin ubicación", gl: "Sen localización", en: "No location" },
  presenting: { es: "Presentando", gl: "Presentando", en: "Presenting" },
  noTeamPresenting: {
    es: "Ningún equipo presentando.",
    gl: "Ningún equipo presentando.",
    en: "No team presenting.",
  },
  calledTeams: {
    es: "Equipos llamados ({count})",
    gl: "Equipos chamados ({count})",
    en: "Called teams ({count})",
  },
  noTeamsCalled: {
    es: "No hay equipos llamados.",
    gl: "Non hai equipos chamados.",
    en: "No teams called.",
  },
  renotify: { es: "Volver a avisar", gl: "Volver avisar", en: "Renotify" },
  teamRenotified: {
    es: "Equipo avisado de nuevo.",
    gl: "Equipo avisado de novo.",
    en: "Team renotified.",
  },
  bringIn: { es: "Hacer pasar", gl: "Facer pasar", en: "Bring in" },
  teamBroughtIn: {
    es: "El equipo ha pasado a la sala.",
    gl: "O equipo pasou á sala.",
    en: "Team brought into room.",
  },
  requeue: { es: "Reencolar", gl: "Reencolar", en: "Requeue" },
  teamRequeued: { es: "Equipo reencolado.", gl: "Equipo reencolado.", en: "Team requeued." },
  absent: { es: "Ausente", gl: "Ausente", en: "Absent" },
  teamMarkedAbsent: {
    es: "Equipo marcado como ausente.",
    gl: "Equipo marcado como ausente.",
    en: "Team marked absent.",
  },
  nextAtTop: { es: "Siguiente en la cola", gl: "Seguinte na cola", en: "Next at top" },
  noWaitingTeam: {
    es: "Ningún equipo esperando.",
    gl: "Ningún equipo esperando.",
    en: "No waiting team.",
  },
  addWaiting: {
    es: "Añadir a la sala de espera",
    gl: "Engadir á sala de espera",
    en: "Add waiting",
  },
  teamAddedWaiting: {
    es: "Equipo añadido a la sala de espera.",
    gl: "Equipo engadido á sala de espera.",
    en: "Team added to the waiting room.",
  },
  searchProjectPlaceholder: {
    es: "Buscar proyecto, repositorio o id de entrada",
    gl: "Buscar proxecto, repositorio ou id de entrada",
    en: "Search project, repo or entry id",
  },
  noTeamsFound: {
    es: "No se han encontrado equipos.",
    gl: "Non se atoparon equipos.",
    en: "No teams found.",
  },
  top: { es: "Arriba", gl: "Arriba", en: "Top" },
  teamMovedTop: {
    es: "Equipo movido al principio de la cola.",
    gl: "Equipo movido ao principio da cola.",
    en: "Team moved to the top of the queue.",
  },
  waiting: { es: "Sala de espera", gl: "Sala de espera", en: "Waiting" },
  repoNumber: { es: "Repositorio #{id}", gl: "Repositorio #{id}", en: "Repo #{id}" },
  entryNumber: { es: "Entrada #{id}", gl: "Entrada #{id}", en: "Entry #{id}" },
  teamMembers: { es: "Miembros del equipo", gl: "Membros do equipo", en: "Team members" },
  noMembersLinked: {
    es: "Ningún miembro vinculado a este equipo.",
    gl: "Ningún membro vinculado a este equipo.",
    en: "No members linked to this team.",
  },

  // ---- Staff: accreditation scanning ----
  accreditationDeniedTitle: {
    es: "No puedes acreditar",
    gl: "Non podes acreditar",
    en: "You can't accredit",
  },
  accreditationDeniedDesc: {
    es: "Se requiere el permiso de escaneo de acreditación.",
    gl: "Requírese o permiso de escaneo de acreditación.",
    en: "The accreditation scan capability is required.",
  },
  accreditationDescription: {
    es: "Busca a la persona (entrada, acreditación, nombre o correo) y asigna o cambia su acreditación desde su ficha.",
    gl: "Busca a persoa (entrada, acreditación, nome ou correo) e asigna ou cambia a súa acreditación desde a súa ficha.",
    en: "Find the person (ticket, badge, name or email) and assign or replace their badge from their card.",
  },
  personSearchTitle: { es: "Buscar persona", gl: "Buscar persoa", en: "Find person" },
  personSearchDesc: {
    es: "Escanea el QR de la entrada o de una acreditación (también una antigua), o escribe nombre, apellidos o correo.",
    gl: "Escanea o QR da entrada ou dunha acreditación (tamén unha antiga), ou escribe nome, apelidos ou correo.",
    en: "Scan an entrance or badge QR (old badges work too), or type a name, surname or email.",
  },
  personSearchPlaceholder: {
    es: "QR de entrada, acreditación, nombre o correo",
    gl: "QR de entrada, acreditación, nome ou correo",
    en: "ticket QR, badge, name or email",
  },
  matchTicket: { es: "entrada", gl: "entrada", en: "ticket" },
  matchBadge: { es: "acreditación", gl: "acreditación", en: "badge" },
  matchOldBadge: { es: "acreditación antigua", gl: "acreditación antiga", en: "old badge" },
  dniLabel: { es: "DNI", gl: "DNI", en: "ID number" },
  assignBadgeAction: {
    es: "Asignar acreditación",
    gl: "Asignar acreditación",
    en: "Assign badge",
  },
  changeBadgeDesc: {
    es: "Escanea o escribe la nueva acreditación. La anterior queda rechazada en todos los escáneres y sus pases de wallet se anulan.",
    gl: "Escanea ou escribe a nova acreditación. A anterior queda rexeitada en todos os escáneres e os seus pases de wallet anúlanse.",
    en: "Scan or type the new badge. The old one is rejected at every scanner and its wallet passes are voided.",
  },
  checkedInSession: {
    es: "Acreditados en esta sesión",
    gl: "Acreditados nesta sesión",
    en: "Checked in this session",
  },
  onThisDevice: { es: "En este dispositivo", gl: "Neste dispositivo", en: "On this device" },
  ticketLookupFailed: {
    es: "No se ha podido buscar la entrada.",
    gl: "Non se puido buscar a entrada.",
    en: "Ticket lookup failed.",
  },
  userSearchFailed: {
    es: "La búsqueda de usuarios ha fallado.",
    gl: "A busca de usuarios fallou.",
    en: "User search failed.",
  },
  userLookupFailed: {
    es: "No se ha podido buscar al usuario.",
    gl: "Non se puido buscar o usuario.",
    en: "User lookup failed.",
  },
  checkInFailed: {
    es: "No se ha podido registrar la entrada.",
    gl: "Non se puido rexistrar a entrada.",
    en: "Check-in failed.",
  },
  badgeAssigned: {
    es: "Acreditación {badgeId} asignada a {name}.",
    gl: "Acreditación {badgeId} asignada a {name}.",
    en: "Badge {badgeId} assigned to {name}.",
  },
  badgeRotatedTo: {
    es: "Acreditación cambiada a {badge}.",
    gl: "Acreditación cambiada a {badge}.",
    en: "Badge rotated to {badge}.",
  },
  badgeRotationFailed: {
    es: "No se ha podido cambiar la acreditación.",
    gl: "Non se puido cambiar a acreditación.",
    en: "Badge rotation failed.",
  },
  ticketCheckIn: { es: "Registro de entrada", gl: "Rexistro de entrada", en: "Ticket check-in" },
  ticketCheckInDesc: {
    es: "Escanea el QR de entrada, confirma la ficha de la persona y asigna la acreditación física.",
    gl: "Escanea o QR de entrada, confirma a ficha da persoa e asigna a acreditación física.",
    en: "Scan an entrance QR, confirm the person card, then assign the physical badge.",
  },
  ticketTokenLabel: { es: "Token de la entrada", gl: "Token da entrada", en: "Ticket token" },
  ticketTokenPlaceholder: {
    es: "contenido del QR de entrada",
    gl: "contido do QR de entrada",
    en: "ticket QR payload",
  },
  lookup: { es: "Buscar", gl: "Buscar", en: "Lookup" },
  findUser: { es: "Buscar usuario", gl: "Buscar usuario", en: "Find user" },
  findUserPlaceholder: {
    es: "nombre, apellidos o correo",
    gl: "nome, apelidos ou correo",
    en: "name, surname or email",
  },
  search: { es: "Buscar", gl: "Buscar", en: "Search" },
  confirmedStatus: { es: "confirmado", gl: "confirmado", en: "confirmed" },
  noAppStatus: { es: "sin solicitud", gl: "sen solicitude", en: "no app" },
  badgeIdLabel: { es: "ID de acreditación", gl: "ID de acreditación", en: "Badge ID" },
  badgeIdPlaceholder: { es: "B-1024", gl: "B-1024", en: "B-1024" },
  methodLabel: { es: "Método", gl: "Método", en: "Method" },
  manual: { es: "Manual", gl: "Manual", en: "Manual" },
  checkIn: { es: "Registrar entrada", gl: "Rexistrar entrada", en: "Check in" },
  lostBadge: { es: "Acreditación perdida", gl: "Acreditación perdida", en: "Lost badge" },
  lostBadgeDesc: {
    es: "Cambia una acreditación y anula los pases de wallet activos.",
    gl: "Cambia unha acreditación e anula os pases de wallet activos.",
    en: "Rotate a badge and void active badge wallet passes.",
  },
  userIdLabel: { es: "ID de usuario", gl: "ID de usuario", en: "User ID" },
  currentBadgeLabel: { es: "Acreditación actual", gl: "Acreditación actual", en: "Current badge" },
  currentBadgePlaceholder: {
    es: "o escanea la acreditación antigua",
    gl: "ou escanea a acreditación antiga",
    en: "or scan old badge",
  },
  newBadgeLabel: { es: "Nueva acreditación", gl: "Nova acreditación", en: "New badge" },
  reasonLabel: { es: "Motivo", gl: "Motivo", en: "Reason" },
  reasonPlaceholder: {
    es: "perdida, dañada, ilegible…",
    gl: "perdida, danada, ilexible…",
    en: "lost, damaged, unreadable…",
  },
  rotateBadge: { es: "Cambiar acreditación", gl: "Cambiar acreditación", en: "Rotate badge" },

  // ---- Staff: presence scanning ----
  presenceDeniedTitle: {
    es: "No puedes escanear presencia",
    gl: "Non podes escanear presenza",
    en: "You can't scan presence",
  },
  presenceDeniedDesc: {
    es: "Se requiere el permiso de escaneo de presencia.",
    gl: "Requírese o permiso de escaneo de presenza.",
    en: "The presence scan capability is required.",
  },
  presenceDescription: {
    es: "Escanea una acreditación en la puerta para registrar una entrada o salida; las horas de asistencia se estiman a partir de todas las señales.",
    gl: "Escanea unha acreditación na porta para rexistrar unha entrada ou saída; as horas de asistencia estímanse a partir de todas as sinais.",
    en: "Scan a badge at the door to register an entry or exit; attendance hours are estimated from all signals.",
  },
  presentNow: { es: "Presentes ahora", gl: "Presentes agora", en: "Present now" },
  liveEstimate: { es: "Estimación en directo", gl: "Estimación en directo", en: "Live estimate" },
  reconnectsAutomatically: {
    es: "Se reconecta automáticamente",
    gl: "Reconéctase automaticamente",
    en: "Reconnects automatically",
  },
  openSessions: { es: "Sesiones abiertas", gl: "Sesións abertas", en: "Open sessions" },
  enteredNotExited: {
    es: "Han entrado, no han salido",
    gl: "Entraron, non saíron",
    en: "Entered, not yet exited",
  },
  staleSessions: {
    es: "Sesiones desactualizadas",
    gl: "Sesións desactualizadas",
    en: "Stale sessions",
  },
  staleSessionsHint: {
    es: "Sin señal desde hace tiempo — necesitan revisión",
    gl: "Sen sinal desde hai tempo — precisan revisión",
    en: "No signal in a while — needs reconciling",
  },
  badgeLookupFailed: {
    es: "No se ha podido buscar la acreditación.",
    gl: "Non se puido buscar a acreditación.",
    en: "Badge lookup failed.",
  },
  entryRecorded: { es: "Entrada registrada.", gl: "Entrada rexistrada.", en: "Entry recorded." },
  exitRecorded: { es: "Salida registrada.", gl: "Saída rexistrada.", en: "Exit recorded." },
  presenceScanFailed: {
    es: "No se ha podido registrar el escaneo.",
    gl: "Non se puido rexistrar o escaneo.",
    en: "Presence scan failed.",
  },
  manualRecordAdded: {
    es: "Registro manual añadido.",
    gl: "Rexistro manual engadido.",
    en: "Manual record added.",
  },
  couldNotSaveManualRecord: {
    es: "No se ha podido guardar el registro manual.",
    gl: "Non se puido gardar o rexistro manual.",
    en: "Could not save the manual record.",
  },
  columnUser: { es: "Usuario", gl: "Usuario", en: "User" },
  columnHours: { es: "Horas", gl: "Horas", en: "Hours" },
  doorScan: { es: "Escaneo en puerta", gl: "Escaneo na porta", en: "Door scan" },
  doorScanDesc: {
    es: "Escanea una acreditación para cargar a la persona y registrar una entrada o salida.",
    gl: "Escanea unha acreditación para cargar a persoa e rexistrar unha entrada ou saída.",
    en: "Scan a badge to load the person, then register an entry or exit.",
  },
  badgeLabel: { es: "Acreditación", gl: "Acreditación", en: "Badge" },
  badgePlaceholder: { es: "escanear acreditación", gl: "escanear acreditación", en: "scan badge" },
  alreadyOpenSession: {
    es: "Ya tiene una sesión abierta desde las {time} ({hours}). Registra una salida antes de una nueva entrada.",
    gl: "Xa ten unha sesión aberta desde as {time} ({hours}). Rexistra unha saída antes dunha nova entrada.",
    en: "Already has an open session since {time} ({hours}). Register an exit before a new entry.",
  },
  registerEntry: { es: "Registrar entrada", gl: "Rexistrar entrada", en: "Register entry" },
  registerExit: { es: "Registrar salida", gl: "Rexistrar saída", en: "Register exit" },
  cancelManualRecord: {
    es: "Cancelar registro manual",
    gl: "Cancelar rexistro manual",
    en: "Cancel manual record",
  },
  addManualRecord: {
    es: "Añadir un registro manual con fecha anterior",
    gl: "Engadir un rexistro manual con data anterior",
    en: "Add a backdated manual record",
  },
  directionLabel: { es: "Dirección", gl: "Dirección", en: "Direction" },
  entryOption: { es: "Entrada", gl: "Entrada", en: "Entry" },
  exitOption: { es: "Salida", gl: "Saída", en: "Exit" },
  timeLabel: { es: "Hora", gl: "Hora", en: "Time" },
  saveManualRecord: {
    es: "Guardar registro manual",
    gl: "Gardar rexistro manual",
    en: "Save manual record",
  },
  attendanceHours: { es: "Horas de asistencia", gl: "Horas de asistencia", en: "Attendance hours" },
  attendanceHoursDesc: {
    es: "Estimadas a partir de señales de puerta, comidas y actividades.",
    gl: "Estimadas a partir de sinais de porta, comidas e actividades.",
    en: "Estimated from door, meal and activity signals.",
  },
  filterUsers: { es: "Filtrar usuarios…", gl: "Filtrar usuarios…", en: "Filter users…" },
  noPresenceYet: {
    es: "Aún no hay presencia",
    gl: "Aínda non hai presenza",
    en: "No presence yet",
  },
  noPresenceYetDesc: {
    es: "Aquí aparecerán los escaneos de puerta, comidas o actividades.",
    gl: "Aquí aparecerán os escaneos de porta, comidas ou actividades.",
    en: "Door, meal or activity scans will appear here.",
  },
  openSessionsDesc: {
    es: "Han entrado pero no han salido todavía. El sistema nunca las cierra — resuelve las desactualizadas con una salida manual.",
    gl: "Entraron pero aínda non saíron. O sistema nunca as pecha — resolve as desactualizadas cunha saída manual.",
    en: "Entered but not yet exited. The system never closes these — reconcile stale ones with a manual exit.",
  },
  noOpenSessions: {
    es: "No hay sesiones abiertas",
    gl: "Non hai sesións abertas",
    en: "No open sessions",
  },
  noOpenSessionsDesc: {
    es: "Todos los que entraron también han salido.",
    gl: "Todos os que entraron tamén saíron.",
    en: "Everyone who entered has also exited.",
  },
  columnEntered: { es: "Entrada", gl: "Entrada", en: "Entered" },
  columnLastSignal: { es: "Última señal", gl: "Última sinal", en: "Last signal" },
  columnStatus: { es: "Estado", gl: "Estado", en: "Status" },
  staleCheck: {
    es: "Desactualizada — revisar",
    gl: "Desactualizada — revisar",
    en: "Stale — check",
  },
  fresh: { es: "Reciente", gl: "Recente", en: "Fresh" },

  // ---- Staff: meals, activities & logistics stats overview ----
  mealsDeniedTitle: {
    es: "No puedes escanear comidas",
    gl: "Non podes escanear comidas",
    en: "You can't scan meals",
  },
  mealsDeniedDesc: {
    es: "Se requiere el permiso de escaneo de actividad.",
    gl: "Requírese o permiso de escaneo de actividade.",
    en: "The activity scan capability is required.",
  },
  mealsDescription: {
    es: "Sirve comidas escaneando acreditaciones; las repeticiones se marcan y las confirma el equipo.",
    gl: "Serve comidas escaneando acreditacións; as repeticións márcanse e confírmaas o equipo.",
    en: "Serve meals by scanning badges; repeats are flagged and confirmed by staff.",
  },
  columnMeal: { es: "Comida", gl: "Comida", en: "Meal" },
  columnServed: { es: "Servidas", gl: "Servidas", en: "Served" },
  columnPeople: { es: "Personas", gl: "Persoas", en: "People" },
  columnRepeats: { es: "Repeticiones", gl: "Repeticións", en: "Repeats" },
  selectedCount: {
    es: "{count} seleccionadas",
    gl: "{count} seleccionadas",
    en: "{count} selected",
  },
  activitiesDeniedTitle: {
    es: "No puedes escanear actividades",
    gl: "Non podes escanear actividades",
    en: "You can't scan activities",
  },
  activitiesDeniedDesc: {
    es: "Se requiere el permiso de escaneo de actividad.",
    gl: "Requírese o permiso de escaneo de actividade.",
    en: "The activity scan capability is required.",
  },
  activitiesDescription: {
    es: "Registra la asistencia a charlas, talleres y otras actividades escaneables.",
    gl: "Rexistra a asistencia a charlas, obradoiros e outras actividades escaneables.",
    en: "Register attendance at talks, workshops and other scannable activities.",
  },
  logistics: { es: "Logística", gl: "Loxística", en: "Logistics" },
  logisticsDeniedTitle: {
    es: "No puedes acceder a logística",
    gl: "Non podes acceder a loxística",
    en: "You can't access logistics",
  },
  logisticsDeniedDesc: {
    es: "Se requiere el permiso de acreditación, escaneo de comidas/actividades, presencia o estadísticas de logística.",
    gl: "Requírese o permiso de acreditación, escaneo de comidas/actividades, presenza ou estatísticas de loxística.",
    en: "Accreditation, meal/activity scan, presence or logistics stats capability is required.",
  },
  logisticsStatsDeniedTitle: {
    es: "No puedes ver las estadísticas de logística",
    gl: "Non podes ver as estatísticas de loxística",
    en: "You can't view logistics stats",
  },
  logisticsStatsDeniedDesc: {
    es: "Se requiere el permiso de estadísticas de logística.",
    gl: "Requírese o permiso de estatísticas de loxística.",
    en: "The logistics stats capability is required.",
  },
  logisticsStatsDescription: {
    es: "Paneles operativos en directo de acreditación, presencia, comidas y actividades.",
    gl: "Paneis operativos en directo de acreditación, presenza, comidas e actividades.",
    en: "Live operational panels for accreditation, presence, meals and activities.",
  },
  columnCategory: { es: "Categoría", gl: "Categoría", en: "Category" },
  columnScans: { es: "Escaneos", gl: "Escaneos", en: "Scans" },
  accredited: { es: "Acreditados", gl: "Acreditados", en: "Accredited" },
  accreditedHint: {
    es: "Acreditaciones asignadas actualmente",
    gl: "Acreditacións asignadas actualmente",
    en: "Current badge assignments",
  },
  presentNowHint: {
    es: "Estimado a partir de escaneos",
    gl: "Estimado a partir de escaneos",
    en: "Estimated from scans",
  },
  mealsServed: { es: "Comidas servidas", gl: "Comidas servidas", en: "Meals served" },
  mealsServedHint: {
    es: "Incluye repeticiones",
    gl: "Inclúe repeticións",
    en: "Includes repeat servings",
  },
  activityScans: {
    es: "Escaneos de actividad",
    gl: "Escaneos de actividade",
    en: "Activity scans",
  },
  noMealScansYet: {
    es: "Aún no hay escaneos de comidas",
    gl: "Aínda non hai escaneos de comidas",
    en: "No meal scans yet",
  },
  noActivityScansYet: {
    es: "Aún no hay escaneos de actividad",
    gl: "Aínda non hai escaneos de actividade",
    en: "No activity scans yet",
  },
  columnActivity: { es: "Actividad", gl: "Actividade", en: "Activity" },
  registrableActivities: {
    es: "Actividades registrables",
    gl: "Actividades rexistrables",
    en: "Registrable activities",
  },

  // ---- Staff: room administration ----
  queueRooms: { es: "Salas de cola", gl: "Salas de cola", en: "Queue rooms" },
  noAccessRoomAdmin: {
    es: "No puedes acceder a la administración de salas",
    gl: "Non podes acceder á administración de salas",
    en: "You can't access room admin",
  },
  roomAdminDeniedDesc: {
    es: "La administración de salas requiere el permiso queue:admin.",
    gl: "A administración de salas require o permiso queue:admin.",
    en: "Room admin requires the queue:admin capability.",
  },
  couldNotLoadRoomAdminData: {
    es: "No se han podido cargar los datos de administración de salas.",
    gl: "Non se puideron cargar os datos de administración de salas.",
    en: "Could not load room admin data.",
  },
  couldNotLoadRoomDetails: {
    es: "No se han podido cargar los detalles de la sala.",
    gl: "Non se puideron cargar os detalles da sala.",
    en: "Could not load room details.",
  },
  provideNameAndSlug: {
    es: "Indica un nombre y un slug.",
    gl: "Indica un nome e un slug.",
    en: "Provide a name and slug.",
  },
  roomCreated: { es: "Sala creada.", gl: "Sala creada.", en: "Room created." },
  couldNotCreateRoom: {
    es: "No se ha podido crear la sala.",
    gl: "Non se puido crear a sala.",
    en: "Could not create room.",
  },
  roomUpdated: { es: "Sala actualizada.", gl: "Sala actualizada.", en: "Room updated." },
  couldNotUpdateRoom: {
    es: "No se ha podido actualizar la sala.",
    gl: "Non se puido actualizar a sala.",
    en: "Could not update room.",
  },
  roomsAdminDescription: {
    es: "Salas y controles de asignación para el flujo de evaluación.",
    gl: "Salas e controis de asignación para o fluxo de avaliación.",
    en: "Rooms and assignment controls for the judging flow.",
  },
  createRoom: { es: "Crear sala", gl: "Crear sala", en: "Create room" },
  roomsManageDesc: {
    es: "Crea y gestiona las salas de evaluación.",
    gl: "Crea e xestiona as salas de avaliación.",
    en: "Create and manage judging rooms.",
  },
  noRoomsConfigured: {
    es: "No hay salas configuradas",
    gl: "Non hai salas configuradas",
    en: "No rooms configured",
  },
  noRoomsConfiguredDesc: {
    es: "Crea la primera sala de evaluación para empezar a asignar retos.",
    gl: "Crea a primeira sala de avaliación para comezar a asignar retos.",
    en: "Create the first judging room to start assigning challenges.",
  },
  manage: { es: "Gestionar", gl: "Xestionar", en: "Manage" },
  roomFallback: { es: "Sala", gl: "Sala", en: "Room" },
  baseRoomDetails: {
    es: "Datos básicos de la sala",
    gl: "Datos básicos da sala",
    en: "Base room details",
  },
  cancel: { es: "Cancelar", gl: "Cancelar", en: "Cancel" },
  roomDeleted: { es: "Sala eliminada.", gl: "Sala eliminada.", en: "Room deleted." },
  couldNotDeleteRoom: {
    es: "No se ha podido eliminar la sala.",
    gl: "Non se puido eliminar a sala.",
    en: "Could not delete room.",
  },
  deleteRoom: { es: "Eliminar sala", gl: "Eliminar sala", en: "Delete room" },
  saveRoom: { es: "Guardar sala", gl: "Gardar sala", en: "Save room" },
  slugLabel: { es: "Slug", gl: "Slug", en: "Slug" },
  locationLabel: { es: "Ubicación", gl: "Localización", en: "Location" },
  assignments: { es: "Asignaciones", gl: "Asignacións", en: "Assignments" },
  assignmentsDesc: {
    es: "Reto y jueces asignados a esta sala.",
    gl: "Reto e xuíces asignados a esta sala.",
    en: "Challenge and judges assigned to this room.",
  },
  roomChallengeLabel: { es: "Reto de la sala", gl: "Reto da sala", en: "Room challenge" },
  noChallengeAssigned: {
    es: "Ningún reto asignado.",
    gl: "Ningún reto asignado.",
    en: "No challenge assigned.",
  },
  selectChallengePlaceholder: {
    es: "Selecciona un reto",
    gl: "Selecciona un reto",
    en: "Select challenge",
  },
  challengeAssigned: { es: "Reto asignado.", gl: "Reto asignado.", en: "Challenge assigned." },
  couldNotAssignChallenge: {
    es: "No se ha podido asignar el reto.",
    gl: "Non se puido asignar o reto.",
    en: "Could not assign challenge.",
  },
  setChallenge: { es: "Asignar reto", gl: "Asignar reto", en: "Set challenge" },
  assignJudgeLabel: { es: "Asignar juez", gl: "Asignar xuíz", en: "Assign judge" },
  selectJudgePlaceholder: {
    es: "Selecciona un juez",
    gl: "Selecciona un xuíz",
    en: "Select judge",
  },
  judgeAssigned: { es: "Juez asignado.", gl: "Xuíz asignado.", en: "Judge assigned." },
  couldNotAssignJudge: {
    es: "No se ha podido asignar el juez.",
    gl: "Non se puido asignar o xuíz.",
    en: "Could not assign judge.",
  },
  addJudge: { es: "Añadir juez", gl: "Engadir xuíz", en: "Add judge" },
  judgesCount: { es: "Jueces ({count})", gl: "Xuíces ({count})", en: "Judges ({count})" },
  judgeRemoved: { es: "Juez eliminado.", gl: "Xuíz eliminado.", en: "Judge removed." },
  couldNotRemoveJudge: {
    es: "No se ha podido eliminar el juez.",
    gl: "Non se puido eliminar o xuíz.",
    en: "Could not remove judge.",
  },
  remove: { es: "Quitar", gl: "Quitar", en: "Remove" },
  noJudgesAssigned: {
    es: "Ningún juez asignado.",
    gl: "Ningún xuíz asignado.",
    en: "No judges assigned.",
  },

  // ---- Admin: user directory ----
  peopleCountOne: { es: "{count} persona", gl: "{count} persoa", en: "{count} person" },
  peopleCountOther: { es: "{count} personas", gl: "{count} persoas", en: "{count} people" },
  showingFirst: {
    es: "mostrando las primeras {shown}, afina tu búsqueda",
    gl: "amosando as primeiras {shown}, afina a busca",
    en: "showing first {shown}, refine your search",
  },
  browseEveryone: {
    es: "Explora a todas las personas registradas en hackOS.",
    gl: "Explora todas as persoas rexistradas en hackOS.",
    en: "Browse everyone registered in hackOS.",
  },
  searchUsersPlaceholder: {
    es: "Buscar por nombre, apellidos o correo…",
    gl: "Buscar por nome, apelidos ou correo…",
    en: "Search by name, surname or email…",
  },
  anyEmail: { es: "Cualquier correo", gl: "Calquera correo", en: "Any email" },
  anyRole: { es: "Cualquier rol", gl: "Calquera rol", en: "Any role" },
  anySpot: { es: "Cualquier plaza", gl: "Calquera praza", en: "Any spot" },
  confirmed: { es: "Confirmada", gl: "Confirmada", en: "Confirmed" },
  acceptedPending: { es: "Aceptada pendiente", gl: "Aceptada pendente", en: "Accepted pending" },
  declined: { es: "Rechazada", gl: "Rexeitada", en: "Declined" },
  notConfirmed: { es: "Sin confirmar", gl: "Sen confirmar", en: "Not confirmed" },
  columnsLabel: { es: "Columnas", gl: "Columnas", en: "Columns" },
  visibleFields: { es: "Campos visibles", gl: "Campos visibles", en: "Visible fields" },
  colRole: { es: "Rol", gl: "Rol", en: "Role" },
  colApplication: { es: "Solicitud", gl: "Solicitude", en: "Application" },
  colShirt: { es: "Camiseta", gl: "Camiseta", en: "Shirt" },
  colJoined: { es: "Alta", gl: "Alta", en: "Joined" },
  present: { es: "Presente", gl: "Presente", en: "Present" },
  away: { es: "Ausente", gl: "Ausente", en: "Away" },
  noApplication: { es: "Sin solicitud", gl: "Sen solicitude", en: "No application" },
  acceptedUnsent: {
    es: "Aceptada (sin enviar)",
    gl: "Aceptada (sen enviar)",
    en: "Accepted (unsent)",
  },
  rejectedUnsent: {
    es: "Rechazada (sin enviar)",
    gl: "Rexeitada (sen enviar)",
    en: "Rejected (unsent)",
  },
  roleAdmin: { es: "Administrador", gl: "Administrador", en: "Admin" },
  roleJudge: { es: "Juez", gl: "Xuíz", en: "Judge" },
  roleSponsor: { es: "Patrocinador", gl: "Patrocinador", en: "Sponsor" },
  roleStaff: { es: "Equipo", gl: "Equipo", en: "Staff" },
  roleParticipant: { es: "Participante", gl: "Participante", en: "Participant" },
  noMatchingUsers: { es: "Sin coincidencias", gl: "Sen coincidencias", en: "No matching users" },
  noUsersYet: { es: "Aún no hay usuarios", gl: "Aínda non hai usuarios", en: "No users yet" },
  tryDifferentNameEmail: {
    es: "Prueba con otro nombre o correo.",
    gl: "Proba con outro nome ou correo.",
    en: "Try a different name or email.",
  },
  usersAppearHere: {
    es: "Los usuarios aparecerán aquí en cuanto se registren.",
    gl: "Os usuarios aparecerán aquí en canto se rexistren.",
    en: "Users appear here once they register.",
  },
  couldNotLoadUsers: {
    es: "No se han podido cargar los usuarios.",
    gl: "Non se puideron cargar os usuarios.",
    en: "Could not load users.",
  },

  // ---- Admin: invite a user ----
  inviteUser: { es: "Invitar usuario", gl: "Convidar usuario", en: "Invite user" },
  inviteAUser: { es: "Invitar a un usuario", gl: "Convidar a un usuario", en: "Invite a user" },
  inviteUserDesc: {
    es: "Seguirán un enlace para crear su propia cuenta — tú nunca rellenas sus datos.",
    gl: "Seguirán unha ligazón para crear a súa propia conta — ti nunca cubres os seus datos.",
    en: "They follow a link to create their own account — you never fill their data.",
  },
  done: { es: "Hecho", gl: "Feito", en: "Done" },
  sendInvite: { es: "Enviar invitación", gl: "Enviar convite", en: "Send invite" },
  inviteCreatedDesc: {
    es: "Invitación creada — el enlace se ha enviado por correo y se muestra abajo.",
    gl: "Convite creado — a ligazón enviouse por correo e móstrase abaixo.",
    en: "Invite created — the link was emailed and is shown below.",
  },
  couldNotCreateInvite: {
    es: "No se ha podido crear la invitación.",
    gl: "Non se puido crear o convite.",
    en: "Could not create the invite.",
  },
  inviteSentToPrefix: { es: "Invitación enviada a", gl: "Convite enviado a", en: "Invite sent to" },
  inviteSentToSuffix: {
    es: "Comparte este enlace si el correo no llega:",
    gl: "Comparte esta ligazón se o correo non chega:",
    en: "Share this link if the email doesn't arrive:",
  },
  emailPlaceholder: {
    es: "persona@ejemplo.com",
    gl: "persoa@exemplo.com",
    en: "person@example.com",
  },
  accountTypeLabel: { es: "Tipo de cuenta", gl: "Tipo de conta", en: "Account type" },
  staffOrg: {
    es: "Equipo / organización",
    gl: "Equipo / organización",
    en: "Staff / organization",
  },
  sponsorOption: { es: "Patrocinador", gl: "Patrocinador", en: "Sponsor" },
  participantOption: { es: "Participante", gl: "Participante", en: "Participant" },
  enterpriseLabel: { es: "Empresa", gl: "Empresa", en: "Enterprise" },
  selectSponsorEnterprise: {
    es: "Selecciona la empresa del patrocinador",
    gl: "Selecciona a empresa do patrocinador",
    en: "Select the sponsor's enterprise",
  },
  linkedAutomatically: {
    es: "Se vincularán a esta empresa automáticamente cuando acepten.",
    gl: "Vincularanse a esta empresa automaticamente cando acepten.",
    en: "They're linked to this enterprise automatically when they accept.",
  },
  capabilityGroupsLabel: {
    es: "Grupos de permisos",
    gl: "Grupos de permisos",
    en: "Capability groups",
  },
  optionalPreassignGroups: {
    es: "Opcional — preasigna grupos de permisos",
    gl: "Opcional — preasigna grupos de permisos",
    en: "Optional — pre-assign permission groups",
  },
  searchGroupsPlaceholder: { es: "Buscar grupos…", gl: "Buscar grupos…", en: "Search groups…" },
  noPermissionGroupsYet: {
    es: "Aún no hay grupos de permisos.",
    gl: "Aínda non hai grupos de permisos.",
    en: "No permission groups yet.",
  },
  accountHoldsPermissions: {
    es: "La cuenta tendrá estos permisos en cuanto se una.",
    gl: "A conta terá estes permisos en canto se una.",
    en: "The account holds these permissions the moment they join.",
  },

  // ---- Admin: active invitations ----
  couldNotLoadInvitations: {
    es: "No se han podido cargar las invitaciones.",
    gl: "Non se puideron cargar os convites.",
    en: "Could not load invitations.",
  },
  couldNotInviteAction: {
    es: "No se ha podido completar esa acción sobre la invitación.",
    gl: "Non se puido completar esa acción sobre o convite.",
    en: "Could not complete that action on the invite.",
  },
  activeInvitations: {
    es: "Invitaciones activas",
    gl: "Convites activos",
    en: "Active invitations",
  },
  activeInvitationsDesc: {
    es: "Invitaciones pendientes que aún no se han aceptado. Renueva para ampliar el plazo, reenvía el correo, regenera para un enlace nuevo o expira para invalidarla al momento.",
    gl: "Convites pendentes que aínda non se aceptaron. Renova para ampliar o prazo, reenvía o correo, rexenera para unha ligazón nova ou caduca para invalidala ao momento.",
    en: "Pending invites that haven't been accepted yet. Renew to extend the window, resend the email, regenerate for a brand-new link, or expire to invalidate immediately.",
  },
  colType: { es: "Tipo", gl: "Tipo", en: "Type" },
  colEnterprise: { es: "Empresa", gl: "Empresa", en: "Enterprise" },
  colExpires: { es: "Caduca", gl: "Caduca", en: "Expires" },
  colCreated: { es: "Creada", gl: "Creado", en: "Created" },
  searchByEmailType: {
    es: "Buscar por correo o tipo…",
    gl: "Buscar por correo ou tipo…",
    en: "Search by email or type…",
  },
  renew: { es: "Renovar", gl: "Renovar", en: "Renew" },
  expiryExtended: {
    es: "Plazo de caducidad ampliado.",
    gl: "Prazo de caducidade ampliado.",
    en: "Expiry window extended.",
  },
  resendEmail: { es: "Reenviar correo", gl: "Reenviar correo", en: "Resend email" },
  inviteResent: {
    es: "Correo de invitación reenviado.",
    gl: "Correo de convite reenviado.",
    en: "Invite email re-sent.",
  },
  regenerate: { es: "Regenerar", gl: "Rexenerar", en: "Regenerate" },
  newInviteCreated: {
    es: "Nuevo enlace de invitación creado y enviado.",
    gl: "Nova ligazón de convite creada e enviada.",
    en: "New invite link created and emailed.",
  },
  expire: { es: "Caducar", gl: "Caducar", en: "Expire" },
  inviteExpired: { es: "Invitación caducada.", gl: "Convite caducado.", en: "Invite expired." },
  noActiveInvitations: {
    es: "No hay invitaciones activas",
    gl: "Non hai convites activos",
    en: "No active invitations",
  },
  inviteSomeone: {
    es: "Invita a alguien para empezar.",
    gl: "Convida a alguén para comezar.",
    en: "Invite someone to get started.",
  },

  // ---- Judging panel: queue, room & scoring ----
  pastCalls: { es: "Llamadas previas:", gl: "Chamadas previas:", en: "Past calls:" },
  positionHash: {
    es: "Posición #{position}",
    gl: "Posición #{position}",
    en: "Position #{position}",
  },
  calledAt: { es: "Llamado a las {time}", gl: "Chamado ás {time}", en: "Called {time}" },
  challengeFallbackNumber: { es: "Reto #{id}", gl: "Reto #{id}", en: "Challenge #{id}" },
  noAccessJudgingPanel: {
    es: "No puedes acceder al panel de evaluación",
    gl: "Non podes acceder ao panel de avaliación",
    en: "You can't access the judging panel",
  },
  judgingAccessDeniedDesc: {
    es: "El acceso a evaluación requiere el permiso de operador, administrador o juez.",
    gl: "O acceso a avaliación require o permiso de operador, administrador ou xuíz.",
    en: "Judging access requires an operator, admin or judge capability.",
  },
  roomLabel: { es: "Sala", gl: "Sala", en: "Room" },
  selectRoomPlaceholder: {
    es: "Selecciona una sala",
    gl: "Selecciona unha sala",
    en: "Select room",
  },
  challengeLabel: { es: "Reto", gl: "Reto", en: "Challenge" },
  resume: { es: "Reanudar", gl: "Reanudar", en: "Resume" },
  pause: { es: "Pausar", gl: "Pausar", en: "Pause" },
  roomResumed: { es: "Sala reanudada.", gl: "Sala reanudada.", en: "Room resumed." },
  roomPaused: { es: "Sala pausada.", gl: "Sala pausada.", en: "Room paused." },
  exportData: { es: "Exportar datos", gl: "Exportar datos", en: "Export Data" },
  queueExportLabel: { es: "Cola", gl: "Cola", en: "Queue" },
  evaluationsExport: { es: "Evaluaciones", gl: "Avaliacións", en: "Evaluations" },
  noRoomSelected: {
    es: "Ninguna sala seleccionada",
    gl: "Ningunha sala seleccionada",
    en: "No room selected",
  },
  noRoomSelectedDesc: {
    es: "Crea o selecciona una sala de evaluación antes de operar la cola.",
    gl: "Crea ou selecciona unha sala de avaliación antes de operar a cola.",
    en: "Create or select a judging room before operating the queue.",
  },
  couldNotLoadQueueSetup: {
    es: "No se ha podido cargar la configuración de la cola.",
    gl: "Non se puido cargar a configuración da cola.",
    en: "Could not load queue setup.",
  },
  searchFailed: { es: "La búsqueda ha fallado.", gl: "A busca fallou.", en: "Search failed." },
  nextTeamCalled: {
    es: "Siguiente equipo llamado.",
    gl: "Seguinte equipo chamado.",
    en: "Next team called.",
  },
  teamCalled: { es: "Equipo llamado.", gl: "Equipo chamado.", en: "Team called." },
  teamBroughtInShort: { es: "Equipo hecho pasar.", gl: "Equipo pasou.", en: "Team brought in." },
  queueHeading: { es: "Cola", gl: "Cola", en: "Queue" },
  waitingRoomQueueDesc: {
    es: "Sala de espera y cola del reto.",
    gl: "Sala de espera e cola do reto.",
    en: "Waiting room and challenge queue.",
  },
  callNext: { es: "Llamar siguiente", gl: "Chamar seguinte", en: "Call next" },
  waitingRoomCount: {
    es: "Sala de espera ({count})",
    gl: "Sala de espera ({count})",
    en: "Waiting room ({count})",
  },
  queueStatsEvaluated: {
    es: "Evaluados",
    gl: "Avaliados",
    en: "Evaluated",
  },
  queueStatsAvgTime: {
    es: "Tiempo medio/equipo",
    gl: "Tempo medio/equipo",
    en: "Avg time/team",
  },
  queueStatsEstFinish: {
    es: "Fin estimado",
    gl: "Fin estimado",
    en: "Est. finish",
  },
  queueStatsPacingTarget: {
    es: "Objetivo de ritmo",
    gl: "Obxectivo de ritmo",
    en: "Pacing target",
  },
  queueStatsAdjustedHint: {
    es: "Ajustado por el tiempo restante",
    gl: "Axustado polo tempo restante",
    en: "Adjusted for remaining time",
  },
  queueStatsMinutes: {
    es: "{count} min",
    gl: "{count} min",
    en: "{count} min",
  },
  noTeamsWaitingDoor: {
    es: "No hay equipos esperando en la puerta.",
    gl: "Non hai equipos esperando na porta.",
    en: "No teams waiting at the door.",
  },
  teamReturnedQueue: {
    es: "Equipo devuelto a la cola.",
    gl: "Equipo devolto á cola.",
    en: "Team returned to the queue.",
  },
  entranceNoticeSent: {
    es: "Aviso de entrada enviado.",
    gl: "Aviso de entrada enviado.",
    en: "Entrance notice sent.",
  },
  noShowRecorded: {
    es: "Ausencia registrada.",
    gl: "Ausencia rexistrada.",
    en: "No-show recorded.",
  },
  callIn: { es: "Llamar", gl: "Chamar", en: "Call in" },
  moreActions: { es: "Más acciones", gl: "Máis accións", en: "More actions" },
  noShow: { es: "Ausente", gl: "Ausente", en: "No-show" },
  challengeQueueCount: {
    es: "Cola del reto ({count})",
    gl: "Cola do reto ({count})",
    en: "Challenge queue ({count})",
  },
  upcomingTeamsRoom: {
    es: "Próximos equipos para esta sala.",
    gl: "Próximos equipos para esta sala.",
    en: "Upcoming teams for this room.",
  },
  searchTeamsAria: { es: "Buscar equipos", gl: "Buscar equipos", en: "Search teams" },
  noTeamsChallengeQueue: {
    es: "No hay equipos en la cola del reto.",
    gl: "Non hai equipos na cola do reto.",
    en: "No teams in the challenge queue.",
  },
  call: { es: "Llamar", gl: "Chamar", en: "Call" },
  skip: { es: "Saltar", gl: "Saltar", en: "Skip" },
  teamSkipped: { es: "Equipo saltado.", gl: "Equipo saltado.", en: "Team skipped." },
  startTypingFindTeam: {
    es: "Empieza a escribir para buscar un equipo.",
    gl: "Comeza a escribir para buscar un equipo.",
    en: "Start typing to find a team.",
  },
  topOfQueue: { es: "Arriba de la cola", gl: "Arriba da cola", en: "Top of queue" },
  waitingRoomButton: { es: "Sala de espera", gl: "Sala de espera", en: "Waiting room" },
  reviewFallback: { es: "evaluación", gl: "avaliación", en: "review" },
  waitingForNextTeam: {
    es: "Esperando al siguiente equipo",
    gl: "Esperando o seguinte equipo",
    en: "Waiting for next team",
  },
  presentationInProgress: {
    es: "Presentación en curso",
    gl: "Presentación en curso",
    en: "Presentation in progress",
  },
  readyToStart: { es: "Listo para empezar", gl: "Listo para comezar", en: "Ready to start" },
  teamInRoom: { es: "Equipo en la sala", gl: "Equipo na sala", en: "Team in room" },
  bringTeamPrompt: {
    es: "Haz pasar a un equipo para empezar la presentación y la evaluación.",
    gl: "Fai pasar a un equipo para comezar a presentación e a avaliación.",
    en: "Bring in a team to start presentation and scoring.",
  },
  idle: { es: "Inactivo", gl: "Inactivo", en: "Idle" },
  noPresentationInProgress: {
    es: "Ninguna presentación en curso",
    gl: "Ningunha presentación en curso",
    en: "No presentation in progress",
  },
  teamsWaitingDoor: {
    es: "Hay equipos esperando en la puerta.",
    gl: "Hai equipos esperando na porta.",
    en: "There are teams waiting at the door.",
  },
  callNextTeamPrompt: {
    es: "Llama al siguiente equipo a la sala de espera.",
    gl: "Chama ao seguinte equipo á sala de espera.",
    en: "Call the next team into the waiting room.",
  },
  presentationStarted: {
    es: "Presentación iniciada.",
    gl: "Presentación iniciada.",
    en: "Presentation started.",
  },
  start: { es: "Empezar", gl: "Comezar", en: "Start" },
  presentationCompleted: {
    es: "Presentación completada.",
    gl: "Presentación completada.",
    en: "Presentation completed.",
  },
  complete: { es: "Completar", gl: "Completar", en: "Complete" },
  teamSentBackWaiting: {
    es: "Equipo devuelto a la sala de espera.",
    gl: "Equipo devolto á sala de espera.",
    en: "Team sent back to the waiting room.",
  },
  requeueWaitingRoom: {
    es: "Devolver a la sala de espera",
    gl: "Devolver á sala de espera",
    en: "Re-queue to waiting room",
  },
  membersLabel: { es: "Miembros", gl: "Membros", en: "Members" },
  projectLabel: { es: "Proyecto", gl: "Proxecto", en: "Project" },
  currentChallengeLabel: { es: "Reto actual", gl: "Reto actual", en: "Current challenge" },
  challengesLabel: { es: "Retos", gl: "Retos", en: "Challenges" },
  showMore: { es: "Mostrar más", gl: "Amosar máis", en: "Show more" },
  showLess: { es: "Mostrar menos", gl: "Amosar menos", en: "Show less" },
  now: { es: "Ahora", gl: "Agora", en: "Now" },
  timeRemaining: { es: "Tiempo restante", gl: "Tempo restante", en: "Time remaining" },
  timeLimitExceeded: {
    es: "Tiempo límite superado",
    gl: "Tempo límite superado",
    en: "Time limit exceeded",
  },
  wrapUp: { es: "A punto de acabar", gl: "A piques de rematar", en: "Wrap up" },
  onTime: { es: "En tiempo", gl: "En tempo", en: "On time" },
  ofDuration: { es: "de {duration}", gl: "de {duration}", en: "of {duration}" },
  scoring: { es: "Evaluación", gl: "Avaliación", en: "Scoring" },
  scoringFormDesc: {
    es: "El formulario de evaluación aparece cuando hay un equipo en la sala.",
    gl: "O formulario de avaliación aparece cando hai un equipo na sala.",
    en: "A scoring form appears when a team is in the room.",
  },
  noActiveEntrySelected: {
    es: "Ninguna entrada activa seleccionada.",
    gl: "Ningunha entrada activa seleccionada.",
    en: "No active entry selected.",
  },
  scoringSaveDesc: {
    es: "Guarda respuestas mientras evalúas y luego envía la evaluación final.",
    gl: "Garda respostas mentres avalías e despois envía a avaliación final.",
    en: "Save draft answers while judging, then submit the final review.",
  },
  saveDraft: { es: "Guardar borrador", gl: "Gardar borrador", en: "Save draft" },
  submitReview: { es: "Enviar evaluación", gl: "Enviar avaliación", en: "Submit review" },
  noJudgingCriteria: {
    es: "Este reto todavía no tiene criterios de evaluación configurados.",
    gl: "Este reto aínda non ten criterios de avaliación configurados.",
    en: "This challenge does not have judging criteria configured yet.",
  },
  requiredFieldUnansweredOne: {
    es: "{count} campo obligatorio sin responder",
    gl: "{count} campo obrigatorio sen responder",
    en: "{count} required field unanswered",
  },
  requiredFieldUnansweredOther: {
    es: "{count} campos obligatorios sin responder",
    gl: "{count} campos obrigatorios sen responder",
    en: "{count} required fields unanswered",
  },
  activeJudges: { es: "Jueces activos", gl: "Xuíces activos", en: "Active judges" },
  judgeFallback: { es: "Juez", gl: "Xuíz", en: "Judge" },
  notesLabel: { es: "Notas", gl: "Notas", en: "Notes" },
  privateJudgingNotes: {
    es: "Notas privadas de evaluación",
    gl: "Notas privadas de avaliación",
    en: "Private judging notes",
  },
  couldNotLoadReview: {
    es: "No se ha podido cargar la evaluación.",
    gl: "Non se puido cargar a avaliación.",
    en: "Could not load review.",
  },
  reviewSubmitted: {
    es: "Evaluación enviada.",
    gl: "Avaliación enviada.",
    en: "Review submitted.",
  },
  draftSaved: { es: "Borrador guardado.", gl: "Borrador gardado.", en: "Draft saved." },
  couldNotSaveReview: {
    es: "No se ha podido guardar la evaluación.",
    gl: "Non se puido gardar a avaliación.",
    en: "Could not save review.",
  },
  yesLabel: { es: "Sí", gl: "Si", en: "Yes" },
  selectOptionPlaceholder: {
    es: "Selecciona una opción",
    gl: "Selecciona unha opción",
    en: "Select an option",
  },
  keyLabel: { es: "Clave:", gl: "Clave:", en: "Key:" },

  // ---- Admin: application forms ----
  couldNotLoadApplicationForms: {
    es: "No se han podido cargar los formularios de solicitud.",
    gl: "Non se puideron cargar os formularios de solicitude.",
    en: "Could not load application forms.",
  },
  mustBePositiveWholeNumber: {
    es: "Debe ser un número entero positivo",
    gl: "Debe ser un número enteiro positivo",
    en: "Must be a positive whole number",
  },
  formCreated: { es: "Formulario creado.", gl: "Formulario creado.", en: "Form created." },
  couldNotCreateForm: {
    es: "No se ha podido crear el formulario.",
    gl: "Non se puido crear o formulario.",
    en: "Could not create the form.",
  },
  colForm: { es: "Formulario", gl: "Formulario", en: "Form" },
  questionCountOne: { es: "{count} pregunta", gl: "{count} pregunta", en: "{count} question" },
  questionCountOther: { es: "{count} preguntas", gl: "{count} preguntas", en: "{count} questions" },
  colWindow: { es: "Ventana", gl: "Ventá", en: "Window" },
  colOpens: { es: "Abre", gl: "Abre", en: "Opens" },
  colCloses: { es: "Cierra", gl: "Pecha", en: "Closes" },
  colQuota: { es: "Cupo", gl: "Cota", en: "Quota" },
  unlimitedDash: { es: "— sin límite", gl: "— sen límite", en: "— unlimited" },
  applicationsDesc: {
    es: "Define formularios de solicitud por tipo de persona, fija sus ventanas de apertura/cierre y su cupo, y luego revisa las respuestas y envía las decisiones.",
    gl: "Define formularios de solicitude por tipo de persoa, fixa as súas ventás de apertura/peche e a súa cota, e despois revisa as respostas e envía as decisións.",
    en: "Define application forms per person type, set their open/close windows and quota, then review responses and send decisions.",
  },
  newForm: { es: "Nuevo formulario", gl: "Novo formulario", en: "New form" },
  searchFormsPlaceholder: {
    es: "Buscar formularios…",
    gl: "Buscar formularios…",
    en: "Search forms…",
  },
  noApplicationFormsYet: {
    es: "Aún no hay formularios de solicitud",
    gl: "Aínda non hai formularios de solicitude",
    en: "No application forms yet",
  },
  createFirstFormDesc: {
    es: "Crea el primer formulario para que la gente pueda solicitar plaza en tu evento.",
    gl: "Crea o primeiro formulario para que a xente poida solicitar praza no teu evento.",
    en: "Create the first form so people can apply to your event.",
  },
  formsWillAppear: {
    es: "Los formularios aparecerán aquí en cuanto un organizador los cree.",
    gl: "Os formularios aparecerán aquí en canto un organizador os cree.",
    en: "Forms will appear here once an organizer creates them.",
  },
  newApplicationForm: {
    es: "Nuevo formulario de solicitud",
    gl: "Novo formulario de solicitude",
    en: "New application form",
  },
  newApplicationFormDesc: {
    es: "Elige el tipo de persona y la ventana. Añadirás las preguntas en la siguiente pantalla.",
    gl: "Escolle o tipo de persoa e a ventá. Engadirás as preguntas na seguinte pantalla.",
    en: "Pick the person type and window. You'll add questions on the next screen.",
  },
  createForm: { es: "Crear formulario", gl: "Crear formulario", en: "Create form" },
  personTypeLabel: { es: "Tipo de persona", gl: "Tipo de persoa", en: "Person type" },
  blankOpenNow: { es: "Vacío = abre ahora.", gl: "Baleiro = abre agora.", en: "Blank = open now." },
  blankNeverCloses: {
    es: "Vacío = no cierra nunca.",
    gl: "Baleiro = non pecha nunca.",
    en: "Blank = never closes.",
  },
  unlimitedPlaceholder: { es: "Sin límite", gl: "Sen límite", en: "Unlimited" },
  optionalCapDesc: {
    es: "Límite opcional de plazas aceptadas.",
    gl: "Límite opcional de prazas aceptadas.",
    en: "Optional cap on accepted spots.",
  },
  confirmWindowLabel: {
    es: "Ventana de confirmación (h)",
    gl: "Ventá de confirmación (h)",
    en: "Confirm window (h)",
  },
  hoursToConfirmDesc: {
    es: "Horas para confirmar una plaza.",
    gl: "Horas para confirmar unha praza.",
    en: "Hours to confirm a spot.",
  },
  exampleFormNamePlaceholder: {
    es: "Solicitud hacker 2026",
    gl: "Solicitude hacker 2026",
    en: "Hacker application 2026",
  },

  // ---- Account: email addresses ----
  verificationEmailSentCheck: {
    es: "Correo de verificación enviado — revisa esa bandeja para confirmarlo.",
    gl: "Correo de verificación enviado — revisa esa caixa para confirmalo.",
    en: "Verification email sent — check that inbox to confirm it.",
  },
  couldNotSendVerificationEmail: {
    es: "No se ha podido enviar el correo de verificación.",
    gl: "Non se puido enviar o correo de verificación.",
    en: "Could not send the verification email.",
  },
  emailAddressesTitle: {
    es: "Direcciones de correo",
    gl: "Enderezos de correo",
    en: "Email addresses",
  },
  emailAddressesDesc: {
    es: "Tu correo de acceso y una dirección secundaria opcional.",
    gl: "O teu correo de acceso e un enderezo secundario opcional.",
    en: "Your sign-in email and an optional secondary address.",
  },
  primaryEmailLabel: { es: "Correo principal", gl: "Correo principal", en: "Primary email" },
  secondaryEmailLabel: { es: "Correo secundario", gl: "Correo secundario", en: "Secondary email" },
  whyAddSecondaryEmail: {
    es: "¿Por qué añadir un correo secundario?",
    gl: "Por que engadir un correo secundario?",
    en: "Why add a secondary email?",
  },
  secondaryEmailTooltip: {
    es: "Registra el correo que usaste en Devpost para que podamos vincular automáticamente tus proyectos a tu cuenta cuando se importen.",
    gl: "Rexistra o correo que usaches en Devpost para que poidamos vincular automaticamente os teus proxectos á túa conta cando se importen.",
    en: "Register the email you used on Devpost so we can automatically match your projects to your account when imports run.",
  },
  pendingVerification: {
    es: "Verificación pendiente",
    gl: "Verificación pendente",
    en: "Pending verification",
  },
  resend: { es: "Reenviar", gl: "Reenviar", en: "Resend" },
  changeSecondaryEmailPlaceholder: {
    es: "Cambiar correo secundario…",
    gl: "Cambiar correo secundario…",
    en: "Change secondary email…",
  },
  devpostEmailPlaceholder: {
    es: "tu@correo-devpost.com",
    gl: "teu@correo-devpost.com",
    en: "you@devpost-email.com",
  },
  updateAndVerify: {
    es: "Actualizar y verificar",
    gl: "Actualizar e verificar",
    en: "Update & verify",
  },
  addAndVerify: { es: "Añadir y verificar", gl: "Engadir e verificar", en: "Add & verify" },

  // ---- Account: notification preferences & channels ----
  categoryQueueCalls: { es: "Llamadas de cola", gl: "Chamadas de cola", en: "Queue calls" },
  categoryApplicationUpdates: {
    es: "Actualizaciones de solicitud",
    gl: "Actualizacións de solicitude",
    en: "Application updates",
  },
  channelInApp: { es: "En la app", gl: "Na app", en: "In-app" },
  channelPush: { es: "Push", gl: "Push", en: "Push" },
  channelDiscord: { es: "Discord", gl: "Discord", en: "Discord" },
  activityLabel: { es: "Actividad: {title}", gl: "Actividade: {title}", en: "Activity: {title}" },
  activityUnavailable: {
    es: "Actividad #{id} (no disponible)",
    gl: "Actividade #{id} (non dispoñible)",
    en: "Activity #{id} (unavailable)",
  },
  couldNotMarkRead: {
    es: "No se ha podido marcar como leído.",
    gl: "Non se puido marcar como lido.",
    en: "Could not mark this as read.",
  },
  couldNotLoadInboxTitle: {
    es: "No se ha podido cargar tu bandeja de entrada",
    gl: "Non se puido cargar a túa caixa de entrada",
    en: "Could not load your inbox",
  },
  couldNotLoadInboxDesc: {
    es: "Algo ha fallado al cargar tus mensajes.",
    gl: "Algo fallou ao cargar as túas mensaxes.",
    en: "Something went wrong loading your messages.",
  },
  noUnreadMessages: {
    es: "No hay mensajes sin leer",
    gl: "Non hai mensaxes sen ler",
    en: "No unread messages",
  },
  noMessagesYet: { es: "Aún no hay mensajes", gl: "Aínda non hai mensaxes", en: "No messages yet" },
  messagesWillShowUp: {
    es: "Los avisos y otros mensajes de la app aparecerán aquí.",
    gl: "Os avisos e outras mensaxes da app aparecerán aquí.",
    en: "Announcements and other in-app messages will show up here.",
  },
  noAdditionalDetails: {
    es: "No hay más detalles para este mensaje.",
    gl: "Non hai máis detalles para esta mensaxe.",
    en: "No additional details for this message.",
  },
  rangeOfTotal: {
    es: "{start}–{end} de {total}",
    gl: "{start}–{end} de {total}",
    en: "{start}–{end} of {total}",
  },
  couldNotLoadPreferencesTitle: {
    es: "No se han podido cargar tus preferencias",
    gl: "Non se puideron cargar as túas preferencias",
    en: "Could not load your preferences",
  },
  couldNotLoadPreferencesDesc: {
    es: "Las preferencias de notificación no están disponibles ahora mismo.",
    gl: "As preferencias de notificación non están dispoñibles agora mesmo.",
    en: "Notification preferences are unavailable right now.",
  },
  couldNotLoadPreferencesToast: {
    es: "No se han podido cargar tus preferencias.",
    gl: "Non se puideron cargar as túas preferencias.",
    en: "Could not load your preferences.",
  },
  couldNotSavePreference: {
    es: "No se ha podido guardar esta preferencia.",
    gl: "Non se puido gardar esta preferencia.",
    en: "Could not save this preference.",
  },
  reminderAdded: {
    es: "Recordatorio añadido.",
    gl: "Recordatorio engadido.",
    en: "Reminder added.",
  },
  couldNotAddReminder: {
    es: "No se ha podido añadir este recordatorio.",
    gl: "Non se puido engadir este recordatorio.",
    en: "Could not add this reminder.",
  },
  couldNotRemoveReminder: {
    es: "No se ha podido quitar este recordatorio.",
    gl: "Non se puido quitar este recordatorio.",
    en: "Could not remove this reminder.",
  },
  channelForRow: {
    es: "{channel} para {label}",
    gl: "{channel} para {label}",
    en: "{channel} for {label}",
  },
  noUpcomingActivities: {
    es: "No hay actividades próximas disponibles para activar ahora mismo.",
    gl: "Non hai actividades próximas dispoñibles para activar agora mesmo.",
    en: "No upcoming activities available to opt into right now.",
  },

  // ---- Admin: public schedule ----
  couldNotLoadSchedule: {
    es: "No se ha podido cargar el programa.",
    gl: "Non se puido cargar o programa.",
    en: "Could not load schedule.",
  },
  itemsShown: { es: "Elementos mostrados.", gl: "Elementos amosados.", en: "Items shown." },
  itemsHidden: { es: "Elementos ocultados.", gl: "Elementos ocultados.", en: "Items hidden." },
  couldNotUpdateVisibility: {
    es: "No se ha podido actualizar la visibilidad.",
    gl: "Non se puido actualizar a visibilidade.",
    en: "Could not update visibility.",
  },
  scheduleItemDeleted: {
    es: "Elemento del programa eliminado.",
    gl: "Elemento do programa eliminado.",
    en: "Schedule item deleted.",
  },
  couldNotDeleteScheduleItem: {
    es: "No se ha podido eliminar el elemento del programa.",
    gl: "Non se puido eliminar o elemento do programa.",
    en: "Could not delete schedule item.",
  },
  noAccessSchedule: {
    es: "No puedes gestionar el programa",
    gl: "Non podes xestionar o programa",
    en: "You can't manage the schedule",
  },
  scheduleDeniedDesc: {
    es: "Esta página requiere el permiso schedule:manage.",
    gl: "Esta páxina require o permiso schedule:manage.",
    en: "The schedule page requires schedule:manage.",
  },
  colItem: { es: "Elemento", gl: "Elemento", en: "Item" },
  typeActivity: { es: "Actividad", gl: "Actividade", en: "Activity" },
  typeMeal: { es: "Comida", gl: "Comida", en: "Meal" },
  typeWorkshop: { es: "Taller", gl: "Obradoiro", en: "Workshop" },
  typeTalk: { es: "Charla", gl: "Charla", en: "Talk" },
  typeCeremony: { es: "Ceremonia", gl: "Cerimonia", en: "Ceremony" },
  typeOther: { es: "Otro", gl: "Outro", en: "Other" },
  colStarts: { es: "Empieza", gl: "Comeza", en: "Starts" },
  colVisibility: { es: "Visibilidad", gl: "Visibilidade", en: "Visibility" },
  visibilityPublicDefault: { es: "Público", gl: "Público", en: "Public" },
  newItem: { es: "Nuevo elemento", gl: "Novo elemento", en: "New item" },
  searchSchedulePlaceholder: {
    es: "Buscar en el programa…",
    gl: "Buscar no programa…",
    en: "Search schedule…",
  },
  editItemAria: { es: "Editar elemento", gl: "Editar elemento", en: "Edit item" },
  deleteItemAria: { es: "Eliminar elemento", gl: "Eliminar elemento", en: "Delete item" },
  duplicate: { es: "Duplicar", gl: "Duplicar", en: "Duplicate" },
  show: { es: "Mostrar", gl: "Amosar", en: "Show" },
  hide: { es: "Ocultar", gl: "Ocultar", en: "Hide" },
  noScheduleItemsYet: {
    es: "Aún no hay elementos en el programa",
    gl: "Aínda non hai elementos no programa",
    en: "No schedule items yet",
  },
  createFirstEventItem: {
    es: "Crea el primer elemento del programa del evento.",
    gl: "Crea o primeiro elemento do programa do evento.",
    en: "Create the first event calendar item.",
  },
  newScheduleItem: {
    es: "Nuevo elemento del programa",
    gl: "Novo elemento do programa",
    en: "New schedule item",
  },
  scheduleItemCreated: {
    es: "Elemento del programa creado.",
    gl: "Elemento do programa creado.",
    en: "Schedule item created.",
  },
  editScheduleItem: {
    es: "Editar elemento del programa",
    gl: "Editar elemento do programa",
    en: "Edit schedule item",
  },
  scheduleItemUpdated: {
    es: "Elemento del programa actualizado.",
    gl: "Elemento do programa actualizado.",
    en: "Schedule item updated.",
  },
  duplicateScheduleItem: {
    es: "Duplicar elemento del programa",
    gl: "Duplicar elemento do programa",
    en: "Duplicate schedule item",
  },
  scheduleItemDuplicated: {
    es: "Elemento del programa duplicado.",
    gl: "Elemento do programa duplicado.",
    en: "Schedule item duplicated.",
  },
  couldNotSaveScheduleItem: {
    es: "No se ha podido guardar el elemento del programa.",
    gl: "Non se puido gardar o elemento do programa.",
    en: "Could not save schedule item.",
  },
  titleLabel: { es: "Título", gl: "Título", en: "Title" },
  openingCeremonyPlaceholder: {
    es: "Ceremonia de apertura",
    gl: "Cerimonia de apertura",
    en: "Opening ceremony",
  },
  registrableByScanner: {
    es: "Registrable por escáner",
    gl: "Rexistrable por escáner",
    en: "Registrable by scanner",
  },
  mealsAlwaysRegistrable: {
    es: " (las comidas siempre son registrables)",
    gl: " (as comidas son sempre rexistrables)",
    en: " (meals are always registrable)",
  },
  endsLabel: { es: "Termina", gl: "Remata", en: "Ends" },
  addStartTime: { es: "Añadir hora de inicio", gl: "Engadir hora de inicio", en: "Add start time" },
  addEndTime: { es: "Añadir hora de fin", gl: "Engadir hora de fin", en: "Add end time" },
  publishAtLabel: { es: "Publicar el", gl: "Publicar o", en: "Publish at" },
  immediate: { es: "Inmediato", gl: "Inmediato", en: "Immediate" },
  schedulePublication: {
    es: "Programar publicación",
    gl: "Programar publicación",
    en: "Schedule publication",
  },
  mainHallPlaceholder: { es: "Sala principal", gl: "Sala principal", en: "Main hall" },
  descriptionLabel: { es: "Descripción", gl: "Descrición", en: "Description" },
  visibleInPublicAgenda: {
    es: "Visible en el programa público cuando se muestra.",
    gl: "Visible na axenda pública cando se amosa.",
    en: "Visible in the public agenda when shown.",
  },
  save: { es: "Guardar", gl: "Gardar", en: "Save" },
  hiddenOption: { es: "Oculto", gl: "Oculto", en: "Hidden" },
  shownOption: { es: "Mostrado", gl: "Amosado", en: "Shown" },

  // ---- Admin: announcements ----
  couldNotLoadAnnouncements: {
    es: "No se han podido cargar los avisos.",
    gl: "Non se puideron cargar os avisos.",
    en: "Could not load announcements.",
  },
  announcementDeleted: {
    es: "Aviso eliminado.",
    gl: "Aviso eliminado.",
    en: "Announcement deleted.",
  },
  couldNotDeleteAnnouncement: {
    es: "No se ha podido eliminar el aviso.",
    gl: "Non se puido eliminar o aviso.",
    en: "Could not delete announcement.",
  },
  noAccessAnnouncements: {
    es: "No puedes gestionar los avisos",
    gl: "Non podes xestionar os avisos",
    en: "You can't manage announcements",
  },
  announcementsDeniedDesc: {
    es: "Los avisos requieren el permiso announcements:manage.",
    gl: "Os avisos requiren o permiso announcements:manage.",
    en: "Announcements require the announcements:manage capability.",
  },
  colAnnouncement: { es: "Aviso", gl: "Aviso", en: "Announcement" },
  colAudience: { es: "Audiencia", gl: "Audiencia", en: "Audience" },
  participantsAudience: { es: "Participantes", gl: "Participantes", en: "Participants" },
  everyoneAudience: { es: "Todos", gl: "Todos", en: "Everyone" },
  statusScheduled: { es: "Programado", gl: "Programado", en: "Scheduled" },
  statusLive: { es: "En directo", gl: "En directo", en: "Live" },
  statusExpired: { es: "Caducado", gl: "Caducado", en: "Expired" },
  noEnd: { es: "Sin fin", gl: "Sen fin", en: "No end" },
  announcementsDesc: {
    es: "Publica mensajes temporales en pantallas, móviles y la bandeja de entrada.",
    gl: "Publica mensaxes temporais en pantallas, móbiles e a caixa de entrada.",
    en: "Publish timed messages to screens, mobiles and the in-app inbox.",
  },
  newAnnouncement: { es: "Nuevo aviso", gl: "Novo aviso", en: "New announcement" },
  searchAnnouncementsPlaceholder: {
    es: "Buscar avisos…",
    gl: "Buscar avisos…",
    en: "Search announcements…",
  },
  editAnnouncementAria: { es: "Editar aviso", gl: "Editar aviso", en: "Edit announcement" },
  deleteAnnouncementAria: { es: "Eliminar aviso", gl: "Eliminar aviso", en: "Delete announcement" },
  noAnnouncementsYet: {
    es: "Aún no hay avisos",
    gl: "Aínda non hai avisos",
    en: "No announcements yet",
  },
  publishFirstOne: {
    es: "Publica el primero — se difunde a pantallas, notificaciones push y la bandeja de entrada.",
    gl: "Publica o primeiro — difúndese a pantallas, notificacións push e a caixa de entrada.",
    en: "Publish the first one — it fans out to screens, push and the inbox.",
  },
  announcementCreated: { es: "Aviso creado.", gl: "Aviso creado.", en: "Announcement created." },
  announcementUpdated: {
    es: "Aviso actualizado.",
    gl: "Aviso actualizado.",
    en: "Announcement updated.",
  },
  deleteThisAnnouncement: {
    es: "¿Eliminar este aviso?",
    gl: "Eliminar este aviso?",
    en: "Delete this announcement?",
  },
  willStopAppearing: {
    es: '"{title}" dejará de aparecer en todos los sitios donde se difundió.',
    gl: '"{title}" deixará de aparecer en todos os sitios onde se difundiu.',
    en: '"{title}" will stop appearing everywhere it was fanned out to.',
  },
  deleteAction: { es: "Eliminar", gl: "Eliminar", en: "Delete" },
  cantBeUndone: {
    es: "Esta acción no se puede deshacer.",
    gl: "Esta acción non se pode desfacer.",
    en: "This can't be undone.",
  },
  messageLabel: { es: "Mensaje", gl: "Mensaxe", en: "Message" },
  dinnerReadyPlaceholder: {
    es: "La cena está lista",
    gl: "A cea está lista",
    en: "Dinner is ready",
  },
  headToMainHallPlaceholder: {
    es: "Ve a la sala principal — la cena se sirve hasta las 21:00.",
    gl: "Vai á sala principal — a cea sírvese ata as 21:00.",
    en: "Head to the main hall — dinner is served until 9pm.",
  },
  participantsConfirmedOption: {
    es: "Participantes (plaza confirmada o un proyecto)",
    gl: "Participantes (praza confirmada ou un proxecto)",
    en: "Participants (confirmed spot or a project)",
  },
  visibleFrom: { es: "Visible desde", gl: "Visible desde", en: "Visible from" },
  immediatelyLabel: { es: "Inmediatamente", gl: "Inmediatamente", en: "Immediately" },
  scheduleStart: { es: "Programar inicio", gl: "Programar inicio", en: "Schedule start" },
  visibleUntil: { es: "Visible hasta", gl: "Visible ata", en: "Visible until" },
  noEndDate: { es: "Sin fecha de fin", gl: "Sen data de fin", en: "No end date" },
  scheduleEnd: { es: "Programar fin", gl: "Programar fin", en: "Schedule end" },
  endTimeAfterStart: {
    es: "La hora de fin debe ser posterior a la de inicio.",
    gl: "A hora de fin debe ser posterior á de inicio.",
    en: "The end time must be after the start time.",
  },
  enterValidDatesTimes: {
    es: "Introduce fechas y horas válidas antes de guardar el aviso.",
    gl: "Introduce datas e horas válidas antes de gardar o aviso.",
    en: "Enter valid dates and times before saving the announcement.",
  },
  couldNotSaveAnnouncement: {
    es: "No se ha podido guardar el aviso.",
    gl: "Non se puido gardar o aviso.",
    en: "Could not save announcement.",
  },

  // ---- Admin: TV control ----
  couldNotLoadTvMode: {
    es: "No se ha podido cargar el modo de TV actual.",
    gl: "Non se puido cargar o modo de TV actual.",
    en: "Could not load the current TV mode.",
  },
  tvDisplaysUpdated: {
    es: "Pantallas de TV actualizadas.",
    gl: "Pantallas de TV actualizadas.",
    en: "TV displays updated.",
  },
  couldNotUpdateTvDisplays: {
    es: "No se han podido actualizar las pantallas de TV.",
    gl: "Non se puideron actualizar as pantallas de TV.",
    en: "Could not update the TV displays.",
  },
  noAccessTvControl: {
    es: "No puedes controlar las pantallas de TV",
    gl: "Non podes controlar as pantallas de TV",
    en: "You can't control the TV displays",
  },
  tvControlDeniedDesc: {
    es: "Esta página requiere el permiso tv:control.",
    gl: "Esta páxina require o permiso tv:control.",
    en: "This page requires the tv:control capability.",
  },
  tvControlDesc: {
    es: "Cambia todas las pantallas de TV abiertas sin cambiar su URL.",
    gl: "Cambia todas as pantallas de TV abertas sen cambiar o seu URL.",
    en: "Change every open TV display without changing its URL.",
  },
  openTvDisplay: { es: "Abrir pantalla de TV", gl: "Abrir pantalla de TV", en: "Open TV display" },
  displayMode: { es: "Modo de pantalla", gl: "Modo de pantalla", en: "Display mode" },
  currentlyShowing: {
    es: "Mostrando ahora: {mode}.",
    gl: "Amosando agora: {mode}.",
    en: "Currently showing: {mode}.",
  },
  loadingCurrentMode: {
    es: "Cargando el modo actual…",
    gl: "Cargando o modo actual…",
    en: "Loading current mode…",
  },
  showOnTvs: { es: "Mostrar en las TV", gl: "Amosar nas TV", en: "Show on TVs" },
  chooseAMode: { es: "Elige un modo", gl: "Escolle un modo", en: "Choose a mode" },
  modeRooms: { es: "Salas", gl: "Salas", en: "Rooms" },
  modeRoomsDetail: {
    es: "Colas de evaluación en directo agrupadas por reto.",
    gl: "Colas de avaliación en directo agrupadas por reto.",
    en: "Live judging queues grouped by challenge.",
  },
  modeScheduleDetail: {
    es: "Programa del evento publicado.",
    gl: "Programa do evento publicado.",
    en: "Published event agenda.",
  },
  modeSponsorsDetail: {
    es: "Cuadrícula de patrocinadores publicada.",
    gl: "Grade de patrocinadores publicada.",
    en: "Published sponsor grid.",
  },
  modeAnnouncement: { es: "Aviso", gl: "Aviso", en: "Announcement" },
  modeAnnouncementDetail: {
    es: "Un mensaje o el aviso activo actual.",
    gl: "Unha mensaxe ou o aviso activo actual.",
    en: "A message or the current active announcement.",
  },
  modeWifi: { es: "Wi-Fi", gl: "Wi-Fi", en: "Wi-Fi" },
  modeWifiDetail: {
    es: "Detalles de red indicados abajo.",
    gl: "Detalles de rede indicados abaixo.",
    en: "Network details supplied below.",
  },
  modeTimer: { es: "Cronómetro", gl: "Cronómetro", en: "Timer" },
  modeTimerDetail: {
    es: "Cuenta atrás del evento, opcionalmente con una hora de fin personalizada.",
    gl: "Conta atrás do evento, opcionalmente cunha hora de fin personalizada.",
    en: "Event countdown, optionally with a custom end time.",
  },
  leaveBlankShowActive: {
    es: "Déjalo en blanco para mostrar el aviso activo",
    gl: "Déixao en branco para amosar o aviso activo",
    en: "Leave blank to show the active announcement",
  },
  optionalMessageEveryTv: {
    es: "Mensaje opcional para todas las TV",
    gl: "Mensaxe opcional para todas as TV",
    en: "Optional message for every TV",
  },
  networkNameLabel: { es: "Nombre de red", gl: "Nome de rede", en: "Network name" },
  hackathonWifiPlaceholder: { es: "wifi-hackathon", gl: "wifi-hackathon", en: "hackathon-wifi" },
  networkDetailsVisible: {
    es: "Los detalles de red son visibles en todas las TV abiertas.",
    gl: "Os detalles de rede son visibles en todas as TV abertas.",
    en: "Network details are visible on every open TV.",
  },
  timerLabelField: {
    es: "Etiqueta del cronómetro",
    gl: "Etiqueta do cronómetro",
    en: "Timer label",
  },
  customEndTime: {
    es: "Hora de fin personalizada",
    gl: "Hora de fin personalizada",
    en: "Custom end time",
  },
  leaveBlankEventEndTime: {
    es: "Déjalo en blanco para usar la hora de fin del evento.",
    gl: "Déixao en branco para usar a hora de fin do evento.",
    en: "Leave blank to use the event end time.",
  },

  // ---- Admin: user profile detail ----
  couldNotLoadUserProfile: {
    es: "No se ha podido cargar el perfil de este usuario.",
    gl: "Non se puido cargar o perfil deste usuario.",
    en: "Could not load this user's profile.",
  },
  userNotFoundTitle: {
    es: "Usuario no encontrado",
    gl: "Usuario non atopado",
    en: "User not found",
  },
  profileNotLoaded: {
    es: "Este perfil no se ha podido cargar.",
    gl: "Este perfil non se puido cargar.",
    en: "This profile could not be loaded.",
  },
  backToUsers: { es: "Volver a usuarios", gl: "Volver a usuarios", en: "Back to users" },
  tabLogs: { es: "Registros", gl: "Rexistros", en: "Logs" },
  tabApplication: { es: "Solicitud", gl: "Solicitude", en: "Application" },
  colProject: { es: "Proyecto", gl: "Proxecto", en: "Project" },
  none: { es: "Ninguno", gl: "Ningún", en: "None" },
  colPrizes: { es: "Premios", gl: "Premios", en: "Prizes" },
  prizeCountOne: { es: "{count} premio", gl: "{count} premio", en: "{count} prize" },
  prizeCountOther: { es: "{count} premios", gl: "{count} premios", en: "{count} prizes" },
  colLinks: { es: "Enlaces", gl: "Ligazóns", en: "Links" },
  searchProjectsPlaceholder: {
    es: "Buscar proyectos…",
    gl: "Buscar proxectos…",
    en: "Search projects…",
  },
  projectsCouldNotLoad: {
    es: "No se han podido cargar los proyectos",
    gl: "Non se puideron cargar os proxectos",
    en: "Projects could not be loaded",
  },
  couldNotLoadUserProjects: {
    es: "No se han podido cargar los proyectos de este usuario.",
    gl: "Non se puideron cargar os proxectos deste usuario.",
    en: "Could not load this user's projects.",
  },
  noProjectsYet: {
    es: "Aún no hay proyectos",
    gl: "Aínda non hai proxectos",
    en: "No projects yet",
  },
  projectsAppearHere: {
    es: "Los proyectos aparecerán aquí en cuanto este usuario se vincule como miembro de un proyecto.",
    gl: "Os proxectos aparecerán aquí en canto este usuario se vincule como membro dun proxecto.",
    en: "Projects appear here once this user is linked as a project member.",
  },
  openProjects: { es: "Abrir proyectos", gl: "Abrir proxectos", en: "Open projects" },
  badgeIdInline: { es: "acreditación {id}", gl: "acreditación {id}", en: "badge {id}" },
  accredit: { es: "Acreditar", gl: "Acreditar", en: "Accredit" },
  deleteAccount: { es: "Eliminar cuenta", gl: "Eliminar conta", en: "Delete account" },
  deleteThisAccount: {
    es: "¿Eliminar esta cuenta?",
    gl: "Eliminar esta conta?",
    en: "Delete this account?",
  },
  deleteAccountDesc: {
    es: "Esto elimina permanentemente a {name} ({email}). Las cuentas con actividad (auditoría, escaneos, evaluaciones) no se pueden eliminar por completo.",
    gl: "Isto elimina permanentemente a {name} ({email}). As contas con actividade (auditoría, escaneos, avaliacións) non se poden eliminar por completo.",
    en: "This permanently removes {name} ({email}). Accounts with activity (audit, scans, evaluations) can't be hard-deleted.",
  },
  accountDeleted: { es: "Cuenta eliminada.", gl: "Conta eliminada.", en: "Account deleted." },
  couldNotDeleteAccount: {
    es: "No se ha podido eliminar esta cuenta.",
    gl: "Non se puido eliminar esta conta.",
    en: "Could not delete this account.",
  },
  couldNotLoadQrPayloads: {
    es: "No se han podido cargar los códigos QR.",
    gl: "Non se puideron cargar os códigos QR.",
    en: "Could not load QR payloads.",
  },
  couldNotLoadQrCodes: {
    es: "No se han podido cargar los códigos QR",
    gl: "Non se puideron cargar os códigos QR",
    en: "Could not load QR codes",
  },
  ticketAndBadgeQr: {
    es: "QR de entrada y acreditación",
    gl: "QR de entrada e acreditación",
    en: "Ticket and badge QR",
  },
  ticketAndBadgeQrDesc: {
    es: "Úsalos cuando el participante no quiera descargar un pase de Wallet.",
    gl: "Úsaos cando o participante non queira descargar un pase de Wallet.",
    en: "Use these when the participant does not want to download a Wallet pass.",
  },
  profileDetails: { es: "Datos del perfil", gl: "Datos do perfil", en: "Profile details" },
  pendingShort: { es: "Pendiente", gl: "Pendente", en: "Pending" },
  dietaryNotesLabel: { es: "Notas dietéticas", gl: "Notas dietéticas", en: "Dietary notes" },
  editThisUsersDetails: {
    es: "Edita los datos de este usuario. Los cambios quedan registrados en el registro de auditoría.",
    gl: "Edita os datos deste usuario. Os cambios quedan rexistrados no rexistro de auditoría.",
    en: "Edit this user's details. Changes are recorded in the audit log.",
  },
  staffNotesLabel: { es: "Notas del equipo", gl: "Notas do equipo", en: "Staff notes" },
  internalNotesPlaceholder: {
    es: "Notas internas sobre este usuario…",
    gl: "Notas internas sobre este usuario…",
    en: "Internal notes about this user…",
  },
  currentEmailInline: { es: "Actual: {email}", gl: "Actual: {email}", en: "Current: {email}" },
  setSecondaryEmailLabel: {
    es: "Establecer correo secundario",
    gl: "Establecer correo secundario",
    en: "Set secondary email",
  },
  sending: { es: "Enviando…", gl: "Enviando…", en: "Sending…" },
  change: { es: "Cambiar", gl: "Cambiar", en: "Change" },
  setEmail: { es: "Establecer correo", gl: "Establecer correo", en: "Set email" },
  secondaryEmailSetNeedsVerify: {
    es: "Correo secundario establecido. El usuario debe verificarlo.",
    gl: "Correo secundario establecido. O usuario debe verificalo.",
    en: "Secondary email set. The user needs to verify it.",
  },
  couldNotSetSecondaryEmail: {
    es: "No se ha podido establecer el correo secundario.",
    gl: "Non se puido establecer o correo secundario.",
    en: "Could not set secondary email.",
  },
  permissionGroupsTitle: {
    es: "Grupos de permisos",
    gl: "Grupos de permisos",
    en: "Permission groups",
  },
  addToGroupPlaceholder: {
    es: "Añadir a un grupo…",
    gl: "Engadir a un grupo…",
    en: "Add to group…",
  },
  noPermissionGroupsMember: {
    es: "Este usuario no pertenece a ningún grupo de permisos, por lo que no tiene permisos de equipo.",
    gl: "Este usuario non pertence a ningún grupo de permisos, polo que non ten permisos de equipo.",
    en: "This user belongs to no permission groups, so they hold no staff capabilities.",
  },
  removeFromGroupAria: { es: "Quitar de {name}", gl: "Quitar de {name}", en: "Remove from {name}" },
  addedToGroup: { es: "Añadido al grupo.", gl: "Engadido ao grupo.", en: "Added to group." },
  couldNotAddToGroup: {
    es: "No se ha podido añadir al grupo.",
    gl: "Non se puido engadir ao grupo.",
    en: "Could not add to group.",
  },
  removedFromGroup: {
    es: "Quitado del grupo.",
    gl: "Quitado do grupo.",
    en: "Removed from group.",
  },
  couldNotRemoveFromGroup: {
    es: "No se ha podido quitar del grupo.",
    gl: "Non se puido quitar do grupo.",
    en: "Could not remove from group.",
  },
  effectiveCapabilities: {
    es: "Permisos efectivos",
    gl: "Permisos efectivos",
    en: "Effective capabilities",
  },
  noCapabilities: { es: "Sin permisos.", gl: "Sen permisos.", en: "No capabilities." },
  addEnterprisePlaceholder: {
    es: "Añadir empresa…",
    gl: "Engadir empresa…",
    en: "Add enterprise…",
  },
  noEnterprisesToAdd: {
    es: "No hay empresas para añadir",
    gl: "Non hai empresas para engadir",
    en: "No enterprises to add",
  },
  noEnterpriseAffiliations: {
    es: "Sin afiliaciones a empresas.",
    gl: "Sen afiliacións a empresas.",
    en: "No enterprise affiliations.",
  },
  enterpriseAdded: { es: "Empresa añadida.", gl: "Empresa engadida.", en: "Enterprise added." },
  couldNotAddEnterprise: {
    es: "No se ha podido añadir la empresa.",
    gl: "Non se puido engadir a empresa.",
    en: "Could not add enterprise.",
  },
  colLeft: { es: "Salida", gl: "Saída", en: "Left" },
  estimated: { es: "Estimado", gl: "Estimado", en: "Estimated" },
  colDuration: { es: "Duración", gl: "Duración", en: "Duration" },
  colWhen: { es: "Cuándo", gl: "Cando", en: "When" },
  colScannedBy: { es: "Escaneado por", gl: "Escaneado por", en: "Scanned by" },
  presenceDesc: {
    es: "Señales de puerta, comidas y actividades, estimadas en sesiones.",
    gl: "Sinais de porta, comidas e actividades, estimadas en sesións.",
    en: "Door, meal and activity signals, estimated into sessions.",
  },
  estimatedHours: { es: "Horas estimadas", gl: "Horas estimadas", en: "Estimated hours" },
  fromEntryExitActivity: {
    es: "A partir de la actividad de entrada y salida",
    gl: "A partir da actividade de entrada e saída",
    en: "From entry and exit activity",
  },
  presenceIntervals: {
    es: "Intervalos de presencia",
    gl: "Intervalos de presenza",
    en: "Presence intervals",
  },
  estimatedVisitsVenue: {
    es: "Visitas estimadas al recinto",
    gl: "Visitas estimadas ao recinto",
    en: "Estimated visits to the venue",
  },
  noPresenceRecorded: {
    es: "Sin presencia registrada",
    gl: "Sen presenza rexistrada",
    en: "No presence recorded",
  },
  noDoorActivityScans: {
    es: "Este usuario aún no tiene escaneos de puerta ni de actividad.",
    gl: "Este usuario aínda non ten escaneos de porta nin de actividade.",
    en: "This user has no door or activity scans yet.",
  },
  rawDoorScans: {
    es: "Escaneos de puerta sin procesar",
    gl: "Escaneos de porta sen procesar",
    en: "Raw door scans",
  },
  rawDoorScansDesc: {
    es: "Cada escaneo individual de entrada/salida detrás de la estimación anterior. Corrige uno erróneo directamente aquí.",
    gl: "Cada escaneo individual de entrada/saída detrás da estimación anterior. Corrixe un erróneo directamente aquí.",
    en: "Every individual entry/exit scan behind the estimate above. Fix a wrong one directly here.",
  },
  noDoorScansYet: {
    es: "Aún no hay escaneos de puerta",
    gl: "Aínda non hai escaneos de porta",
    en: "No door scans yet",
  },
  doorScansAppearHere: {
    es: "Los escaneos de puerta de este usuario aparecerán aquí.",
    gl: "Os escaneos de porta deste usuario aparecerán aquí.",
    en: "Door scans for this user will appear here.",
  },
  editDoorScan: {
    es: "Editar escaneo de puerta",
    gl: "Editar escaneo de porta",
    en: "Edit door scan",
  },
  changesRecordedAuditLog: {
    es: "Los cambios quedan registrados en el registro de auditoría.",
    gl: "Os cambios quedan rexistrados no rexistro de auditoría.",
    en: "Changes are recorded in the audit log.",
  },
  scanUpdated: { es: "Escaneo actualizado.", gl: "Escaneo actualizado.", en: "Scan updated." },
  couldNotUpdateScan: {
    es: "No se ha podido actualizar este escaneo.",
    gl: "Non se puido actualizar este escaneo.",
    en: "Could not update this scan.",
  },
  deleteThisScan: {
    es: "¿Eliminar este escaneo?",
    gl: "Eliminar este escaneo?",
    en: "Delete this scan?",
  },
  removesEntryExitScan: {
    es: "Elimina el escaneo de {direction} de las {time}. Esta acción no se puede deshacer.",
    gl: "Elimina o escaneo de {direction} das {time}. Esta acción non se pode desfacer.",
    en: "Removes the {direction} scan at {time}. This can't be undone.",
  },
  entryLower: { es: "entrada", gl: "entrada", en: "entry" },
  exitLower: { es: "salida", gl: "saída", en: "exit" },
  scanDeleted: { es: "Escaneo eliminado.", gl: "Escaneo eliminado.", en: "Scan deleted." },
  couldNotDeleteScan: {
    es: "No se ha podido eliminar este escaneo.",
    gl: "Non se puido eliminar este escaneo.",
    en: "Could not delete this scan.",
  },
  applicationsHiddenTitle: {
    es: "Solicitudes ocultas",
    gl: "Solicitudes ocultas",
    en: "Applications hidden",
  },
  needApplicationsReviewCap: {
    es: "Necesitas el permiso applications:review para ver las solicitudes de este usuario.",
    gl: "Precisas o permiso applications:review para ver as solicitudes deste usuario.",
    en: "You need the applications:review capability to see this user's applications.",
  },
  couldNotLoadApplicationsTitle: {
    es: "No se han podido cargar las solicitudes",
    gl: "Non se puideron cargar as solicitudes",
    en: "Could not load applications",
  },
  applicationsUnavailable: {
    es: "Las solicitudes de este usuario no están disponibles ahora mismo.",
    gl: "As solicitudes deste usuario non están dispoñibles agora mesmo.",
    en: "This user's applications are unavailable right now.",
  },
  noApplicationsYet: {
    es: "Aún no hay solicitudes",
    gl: "Aínda non hai solicitudes",
    en: "No applications yet",
  },
  hasntStartedApplication: {
    es: "Este usuario no ha empezado ningún formulario de solicitud.",
    gl: "Este usuario non comezou ningún formulario de solicitude.",
    en: "This user hasn't started any application form.",
  },
  everyFormResponded: {
    es: "Todos los formularios que este usuario ha respondido. Abre uno para revisarlo o editarlo.",
    gl: "Todos os formularios que este usuario respondeu. Abre un para revisalo ou editalo.",
    en: "Every form this user has responded to. Open one to review or edit it.",
  },
  submittedOnInline: {
    es: " · enviado el {date}",
    gl: " · enviado o {date}",
    en: " · submitted {date}",
  },
  draftInline: { es: " · borrador", gl: " · borrador", en: " · draft" },
  opening: { es: "Abriendo…", gl: "Abrindo…", en: "Opening…" },
  open: { es: "Abrir", gl: "Abrir", en: "Open" },
  couldNotOpenApplication: {
    es: "No se ha podido abrir esta solicitud.",
    gl: "Non se puido abrir esta solicitude.",
    en: "Could not open this application.",
  },
  couldNotLoadActivityTitle: {
    es: "No se ha podido cargar la actividad",
    gl: "Non se puido cargar a actividade",
    en: "Could not load activity",
  },
  passesUnavailable: {
    es: "Los pases de este usuario no están disponibles ahora mismo.",
    gl: "Os pases deste usuario non están dispoñibles agora mesmo.",
    en: "This user's passes are unavailable right now.",
  },
  activityPasses: { es: "Pases de actividad", gl: "Pases de actividade", en: "Activity passes" },
  noPassesYet: { es: "Aún no hay pases", gl: "Aínda non hai pases", en: "No passes yet" },
  passesWillAppear: {
    es: "Los pases de comidas y talleres aparecerán aquí a medida que se escaneen.",
    gl: "Os pases de comidas e obradoiros aparecerán aquí a medida que se escaneen.",
    en: "Meal and workshop passes will appear here as they're scanned.",
  },
  auditLogUnavailableTitle: {
    es: "Registro de auditoría no disponible",
    gl: "Rexistro de auditoría non dispoñible",
    en: "Audit log unavailable",
  },
  needAuditReadCap: {
    es: "Necesitas el permiso audit:read para ver el registro de auditoría de este usuario.",
    gl: "Precisas o permiso audit:read para ver o rexistro de auditoría deste usuario.",
    en: "You need the audit:read capability to view this user's audit log.",
  },
  couldNotLoadAuditLog: {
    es: "No se ha podido cargar el registro de auditoría",
    gl: "Non se puido cargar o rexistro de auditoría",
    en: "Could not load audit log",
  },
  auditLogUnavailableNow: {
    es: "El registro de auditoría no está disponible ahora mismo.",
    gl: "O rexistro de auditoría non está dispoñible agora mesmo.",
    en: "The audit log is unavailable right now.",
  },
  colAction: { es: "Acción", gl: "Acción", en: "Action" },
  colEntity: { es: "Entidad", gl: "Entidade", en: "Entity" },
  colSource: { es: "Origen", gl: "Orixe", en: "Source" },
  auditLogDesc: {
    es: "Ediciones del equipo y otros cambios auditados en el registro de este usuario.",
    gl: "Edicións do equipo e outros cambios auditados no rexistro deste usuario.",
    en: "Staff edits and other audited changes to this user's record.",
  },
  noAuditEntriesYet: {
    es: "Aún no hay entradas de auditoría",
    gl: "Aínda non hai entradas de auditoría",
    en: "No audit entries yet",
  },
  auditEntriesAppearHere: {
    es: "Las ediciones del equipo y otros cambios auditados de este usuario aparecerán aquí.",
    gl: "As edicións do equipo e outros cambios auditados deste usuario aparecerán aquí.",
    en: "Staff edits and other audited changes to this user will appear here.",
  },

  // ---- Account: my applications & attendance ----
  tabOverview: { es: "Resumen", gl: "Resumo", en: "Overview" },
  attendanceDataUnavailable: {
    es: "Los datos de asistencia no están disponibles ahora mismo.",
    gl: "Os datos de asistencia non están dispoñibles agora mesmo.",
    en: "Attendance data is unavailable right now.",
  },
  presenceUnavailableTitle: {
    es: "Presencia no disponible",
    gl: "Presenza non dispoñible",
    en: "Presence unavailable",
  },
  presenceUnavailableDesc: {
    es: "Necesitas el permiso presence:scan o logistics:stats para ver la asistencia.",
    gl: "Precisas o permiso presence:scan ou logistics:stats para ver a asistencia.",
    en: "You need the presence:scan or logistics:stats capability to view attendance.",
  },
  couldNotLoadPresenceTitle: {
    es: "No se ha podido cargar la presencia",
    gl: "Non se puido cargar a presenza",
    en: "Could not load presence",
  },
  couldNotLoadYourApplications: {
    es: "No se han podido cargar tus solicitudes.",
    gl: "Non se puideron cargar as túas solicitudes.",
    en: "Could not load your applications.",
  },
  myApplicationsDesc: {
    es: "Sigue los formularios a los que te has presentado, termina cualquier borrador y confirma tu plaza en cuanto te acepten.",
    gl: "Segue os formularios aos que te presentaches, remata calquera borrador e confirma a túa praza en canto te acepten.",
    en: "Track the forms you've applied to, finish any drafts, and confirm your place once you're accepted.",
  },
  myResponses: { es: "Mis respuestas", gl: "As miñas respostas", en: "My responses" },
  myResponsesDesc: {
    es: "Todo lo que has empezado o enviado, con su estado actual.",
    gl: "Todo o que comezaches ou enviaches, co seu estado actual.",
    en: "Everything you've started or submitted, with its current status.",
  },
  notAppliedYetTitle: {
    es: "Aún no te has presentado a nada",
    gl: "Aínda non te presentaches a nada",
    en: "You haven't applied to anything yet",
  },
  notAppliedYetDesc: {
    es: "Los formularios abiertos a los que puedes presentarte se listan abajo.",
    gl: "Os formularios abertos aos que podes presentarte lístanse abaixo.",
    en: "Open forms you can apply to are listed below.",
  },
  submittedOnPrefix: { es: "Enviado el {date}", gl: "Enviado o {date}", en: "Submitted {date}" },
  notSubmittedYet: { es: "Aún sin enviar", gl: "Aínda sen enviar", en: "Not submitted yet" },
  openToApply: { es: "Abiertos para solicitar", gl: "Abertos para solicitar", en: "Open to apply" },
  openToApplyDesc: {
    es: "Formularios que aceptan solicitudes actualmente.",
    gl: "Formularios que aceptan solicitudes actualmente.",
    en: "Forms currently accepting new applications.",
  },
  noOpenFormsTitle: {
    es: "No hay formularios abiertos ahora mismo",
    gl: "Non hai formularios abertos agora mesmo",
    en: "No open forms right now",
  },
  noOpenFormsDesc: {
    es: "Vuelve más tarde — aquí aparecerán las nuevas ventanas de solicitud.",
    gl: "Volve máis tarde — aquí aparecerán as novas ventás de solicitude.",
    en: "Check back later — new application windows will show up here.",
  },
  closesInline: { es: " · cierra el {date}", gl: " · pecha o {date}", en: " · closes {date}" },
  couldNotVerifyLink: {
    es: "No se ha podido verificar este enlace.",
    gl: "Non se puido verificar esta ligazón.",
    en: "Could not verify this link.",
  },
  alreadyVerifiedAddress: {
    es: "Esta dirección ya estaba verificada.",
    gl: "Este enderezo xa estaba verificado.",
    en: "This address was already verified.",
  },
  willUseToMatchDevpost: {
    es: "La usaremos para vincular tus proyectos de Devpost al importarlos.",
    gl: "Usarémolo para vincular os teus proxectos de Devpost ao importalos.",
    en: "We'll use it to match your Devpost projects on import.",
  },
  couldntVerifyTitle: {
    es: "No se ha podido verificar",
    gl: "Non se puido verificar",
    en: "Couldn't verify",
  },
  fieldRequired: {
    es: "Este campo es obligatorio",
    gl: "Este campo é obrigatorio",
    en: "This field is required",
  },
  couldNotSaveDraft: {
    es: "No se ha podido guardar tu borrador.",
    gl: "Non se puido gardar o teu borrador.",
    en: "Could not save your draft.",
  },
  fillRequiredFields: {
    es: "Rellena todos los campos obligatorios.",
    gl: "Cobre todos os campos obrigatorios.",
    en: "Please fill in all required fields.",
  },
  applicationSubmitted: {
    es: "Solicitud enviada.",
    gl: "Solicitude enviada.",
    en: "Application submitted.",
  },
  couldNotSubmitApplication: {
    es: "No se ha podido enviar tu solicitud.",
    gl: "Non se puido enviar a túa solicitude.",
    en: "Could not submit your application.",
  },
  placeConfirmedSeeYou: {
    es: "Tu plaza está confirmada. ¡Nos vemos allí!",
    gl: "A túa praza está confirmada. Vémonos alí!",
    en: "Your place is confirmed. See you there!",
  },
  couldNotConfirmPlace: {
    es: "No se ha podido confirmar tu plaza.",
    gl: "Non se puido confirmar a túa praza.",
    en: "Could not confirm your place.",
  },
  placeReleasedMsg: {
    es: "Has liberado tu plaza.",
    gl: "Liberaches a túa praza.",
    en: "You've released your place.",
  },
  couldNotReleasePlace: {
    es: "No se ha podido liberar tu plaza.",
    gl: "Non se puido liberar a túa praza.",
    en: "Could not release your place.",
  },
  notAvailable: { es: "No disponible", gl: "Non dispoñible", en: "Not available" },
  applicationNotOpenTitle: {
    es: "Esta solicitud no está abierta",
    gl: "Esta solicitude non está aberta",
    en: "This application isn't open",
  },
  applicationNotOpenDesc: {
    es: "El formulario puede haberse cerrado o no existir. Vuelve para ver qué está abierto.",
    gl: "O formulario pode terse pechado ou non existir. Volve para ver que está aberto.",
    en: "The form may have closed or doesn't exist. Head back to see what's open.",
  },
  backToMyApplications: {
    es: "Volver a mis solicitudes",
    gl: "Volver ás miñas solicitudes",
    en: "Back to my applications",
  },
  yourApplicationFallback: { es: "Tu solicitud", gl: "A túa solicitude", en: "Your application" },
  youreInConfirmTitle: {
    es: "Estás dentro — confirma tu plaza",
    gl: "Estás dentro — confirma a túa praza",
    en: "You're in — confirm your place",
  },
  youreInConfirmDesc: {
    es: "Te han aceptado. Confirma para asegurar tu plaza antes de que se cierre el plazo, o recházala si no puedes venir.",
    gl: "Aceptáronte. Confirma para asegurar a túa praza antes de que peche o prazo, ou rexéitaa se non podes vir.",
    en: "You've been accepted. Confirm to lock in your spot before the window closes, or decline if you can't make it.",
  },
  headsUp: { es: "Atención", gl: "Atención", en: "Heads up" },
  dietaryDataDeletedWarn: {
    es: "Si rechazas la plaza (o no confirmas a tiempo), se eliminan los datos dietéticos que hayas compartido.",
    gl: "Se rexeitas a praza (ou non confirmas a tempo), elimínanse os datos dietéticos que compartiches.",
    en: "If you decline (or don't confirm in time), any dietary data you shared is deleted.",
  },
  confirmPlace: { es: "Confirmar plaza", gl: "Confirmar praza", en: "Confirm place" },
  placeConfirmedTitle: {
    es: "Tu plaza está confirmada",
    gl: "A túa praza está confirmada",
    en: "Your place is confirmed",
  },
  placeConfirmedDesc: {
    es: "Todo listo. ¡Nos vemos en el evento!",
    gl: "Todo listo. Vémonos no evento!",
    en: "You're all set. See you at the event!",
  },
  canReleaseAnytime: {
    es: "¿No puedes venir al final? Puedes liberar tu plaza en cualquier momento para que los organizadores se la ofrezcan a otra persona.",
    gl: "Non podes vir ao final? Podes liberar a túa praza en calquera momento para que os organizadores a ofrezan a outra persoa.",
    en: "Can't make it after all? You can release your place at any time so the organizers can offer it to someone else.",
  },
  cantAttendRelease: {
    es: "No puedo asistir — liberar mi plaza",
    gl: "Non podo asistir — liberar a miña praza",
    en: "I can't attend — release my place",
  },
  releaseYourPlace: {
    es: "¿Liberar tu plaza?",
    gl: "Liberar a túa praza?",
    en: "Release your place?",
  },
  releaseYourPlaceDesc: {
    es: "Esto renuncia a tu plaza confirmada en el evento.",
    gl: "Isto renuncia á túa praza confirmada no evento.",
    en: "This gives up your confirmed spot at the event.",
  },
  keepMyPlace: { es: "Mantener mi plaza", gl: "Manter a miña praza", en: "Keep my place" },
  yesReleaseMyPlace: {
    es: "Sí, liberar mi plaza",
    gl: "Si, liberar a miña praza",
    en: "Yes, release my place",
  },
  releaseCantBeUndone: {
    es: "Esto no se puede deshacer desde aquí — necesitarías que los organizadores te volvieran a invitar. Los datos dietéticos que compartiste se eliminan al liberar tu plaza.",
    gl: "Isto non se pode desfacer desde aquí — precisarías que os organizadores te volvesen convidar. Os datos dietéticos que compartiches elimínanse ao liberar a túa praza.",
    en: "This can't be undone from here — you'd need the organizers to re-invite you. Any dietary data you shared is deleted when you release your place.",
  },
  declinedThisPlaceTitle: {
    es: "Has rechazado esta plaza",
    gl: "Rexeitaches esta praza",
    en: "You declined this place",
  },
  declinedThisPlaceDesc: {
    es: "Si ha sido un error, contacta con los organizadores.",
    gl: "Se foi un erro, contacta cos organizadores.",
    en: "If this was a mistake, contact the organizers.",
  },
  confirmationExpiredTitle: {
    es: "Tu ventana de confirmación ha caducado",
    gl: "A túa ventá de confirmación caducou",
    en: "Your confirmation window expired",
  },
  confirmationExpiredDesc: {
    es: "Pide a la organización que reenvíe tu aceptación si aún quieres asistir.",
    gl: "Pide á organización que reenvíe a túa aceptación se aínda queres asistir.",
    en: "Ask the organization to resend your acceptance if you'd still like to attend.",
  },
  privacyNoticeTitle: {
    es: "Aviso de privacidad",
    gl: "Aviso de privacidade",
    en: "Privacy notice",
  },
  yourAnswers: { es: "Tus respuestas", gl: "As túas respostas", en: "Your answers" },
  yourSubmittedAnswers: {
    es: "Tus respuestas enviadas",
    gl: "As túas respostas enviadas",
    en: "Your submitted answers",
  },
  fillFormBelowDesc: {
    es: "Rellena el formulario de abajo. Guarda un borrador cuando quieras; envíalo cuando estés listo.",
    gl: "Cobre o formulario de abaixo. Garda un borrador cando queiras; envíao cando esteas listo.",
    en: "Fill in the form below. Save a draft anytime; submit when you're ready.",
  },
  applicationLockedDesc: {
    es: "Esta solicitud está bloqueada y ya no se puede editar.",
    gl: "Esta solicitude está bloqueada e xa non se pode editar.",
    en: "This application is locked and can no longer be edited.",
  },
  submitApplication: { es: "Enviar solicitud", gl: "Enviar solicitude", en: "Submit application" },
  verifyEmailToSubmitTitle: {
    es: "Verifica tu correo para enviar",
    gl: "Verifica o teu correo para enviar",
    en: "Verify your email to submit",
  },
  verifyEmailToSubmitDesc: {
    es: "Puedes guardar un borrador ahora, pero para enviarlo necesitas un correo verificado.",
    gl: "Podes gardar un borrador agora, pero para envialo precisas un correo verificado.",
    en: "You can save a draft now, but submitting requires a verified email address.",
  },
  formHasNoQuestions: {
    es: "Este formulario no tiene preguntas que responder.",
    gl: "Este formulario non ten preguntas que responder.",
    en: "This form has no questions to answer.",
  },
  noAnswersSaved: {
    es: "No se ha guardado ninguna respuesta.",
    gl: "Non se gardou ningunha resposta.",
    en: "No answers were saved.",
  },

  // ---- Admin: projects (Devpost imports) ----
  couldNotLoadProjects: {
    es: "No se han podido cargar los proyectos.",
    gl: "Non se puideron cargar os proxectos.",
    en: "Could not load projects.",
  },
  noAccessProjects: {
    es: "No puedes acceder a proyectos",
    gl: "Non podes acceder a proxectos",
    en: "You can't access projects",
  },
  projectAccessDeniedDesc: {
    es: "El acceso a proyectos requiere el permiso projects:read.",
    gl: "O acceso a proxectos require o permiso projects:read.",
    en: "Project access requires the projects:read capability.",
  },
  projectsDesc: {
    es: "Envíos de Devpost importados a hackOS, con equipos, retos y premios.",
    gl: "Envíos de Devpost importados a hackOS, con equipos, retos e premios.",
    en: "Devpost submissions imported into hackOS, with teams, challenges and prizes.",
  },
  importFromDevpost: {
    es: "Importar desde Devpost",
    gl: "Importar desde Devpost",
    en: "Import from Devpost",
  },
  colTeam: { es: "Equipo", gl: "Equipo", en: "Team" },
  noMembers: { es: "Sin miembros", gl: "Sen membros", en: "No members" },
  allLinked: { es: "Todo vinculado", gl: "Todo vinculado", en: "All linked" },
  manualCountBadge: { es: "{count} manual", gl: "{count} manual", en: "{count} manual" },
  importDevpostToStart: {
    es: "Importa las exportaciones de proyectos y participantes de Devpost para empezar.",
    gl: "Importa as exportacións de proxectos e participantes de Devpost para comezar.",
    en: "Import the Devpost projects and participants exports to get started.",
  },
  projectsAppearAfterImport: {
    es: "Los proyectos aparecerán aquí en cuanto un organizador importe la exportación de Devpost.",
    gl: "Os proxectos aparecerán aquí en canto un organizador importe a exportación de Devpost.",
    en: "Projects appear here once an organizer imports the Devpost export.",
  },
  couldNotLoadProject: {
    es: "No se ha podido cargar el proyecto.",
    gl: "Non se puido cargar o proxecto.",
    en: "Could not load project.",
  },
  projectNotFoundTitle: {
    es: "Proyecto no encontrado",
    gl: "Proxecto non atopado",
    en: "Project not found",
  },
  manualAdds: { es: "Añadidos manuales", gl: "Engadidos manuais", en: "Manual adds" },
  linksTitle: { es: "Enlaces", gl: "Ligazóns", en: "Links" },
  externalSubmissionUrls: {
    es: "URLs de envío externas.",
    gl: "URLs de envío externas.",
    en: "External submission URLs.",
  },
  noLinksProject: {
    es: "Este proyecto no tiene enlaces.",
    gl: "Este proxecto non ten ligazóns.",
    en: "No links on this project.",
  },
  teamSectionTitle: { es: "Equipo", gl: "Equipo", en: "Team" },
  teamSectionDesc: {
    es: "Miembros actuales del equipo. Los usuarios añadidos aparecen de inmediato en la cola.",
    gl: "Membros actuais do equipo. Os usuarios engadidos aparecen de inmediato na cola.",
    en: "Current team membership. Added users are live in the queue surface immediately.",
  },
  noTeamMembersTitle: {
    es: "Sin miembros de equipo",
    gl: "Sen membros de equipo",
    en: "No team members",
  },
  addUserVisibleDesc: {
    es: "Añade un usuario para que este proyecto sea visible en las vistas de participantes y de cola.",
    gl: "Engade un usuario para que este proxecto sexa visible nas vistas de participantes e de cola.",
    en: "Add a user to make this project visible in participant and queue views.",
  },
  addedManually: { es: "Añadido manualmente", gl: "Engadido manualmente", en: "Added manually" },
  challengesSectionDesc: {
    es: "Participación actual en retos de este proyecto.",
    gl: "Participación actual en retos deste proxecto.",
    en: "Current challenge participation for this project.",
  },
  noChallengesAssignedTitle: {
    es: "Ningún reto asignado",
    gl: "Ningún reto asignado",
    en: "No challenges assigned",
  },
  addChallengeQueueDesc: {
    es: "Añade el proyecto a un reto para colocarlo en la cola.",
    gl: "Engade o proxecto a un reto para colocalo na cola.",
    en: "Add the project to a challenge to place it in the queue.",
  },
  roomColon: { es: "Sala: {room}", gl: "Sala: {room}", en: "Room: {room}" },
  noRoomAssigned: {
    es: "Ninguna sala asignada",
    gl: "Ningunha sala asignada",
    en: "No room assigned",
  },
  linkedByPrizeOne: {
    es: "Vinculado por {count} premio",
    gl: "Vinculado por {count} premio",
    en: "Linked by {count} prize",
  },
  linkedByPrizeOther: {
    es: "Vinculado por {count} premios",
    gl: "Vinculado por {count} premios",
    en: "Linked by {count} prizes",
  },
  prizeBadge: { es: "Premio", gl: "Premio", en: "Prize" },
  challengeRemoved: { es: "Reto eliminado.", gl: "Reto eliminado.", en: "Challenge removed." },
  couldNotRemoveChallenge: {
    es: "No se ha podido eliminar el reto.",
    gl: "Non se puido eliminar o reto.",
    en: "Could not remove challenge.",
  },
  prizesSectionDesc: {
    es: "Participación en premios importados de Devpost para este proyecto.",
    gl: "Participación en premios importados de Devpost para este proxecto.",
    en: "Imported Devpost prize participation for this project.",
  },
  noPrizesImportedTitle: {
    es: "Ningún premio importado",
    gl: "Ningún premio importado",
    en: "No prizes imported",
  },
  prizesAppearAfterImport: {
    es: "Los premios aparecerán aquí tras una importación de Devpost.",
    gl: "Os premios aparecerán aquí despois dunha importación de Devpost.",
    en: "Prizes appear here after a Devpost import.",
  },
  linkedToChallenges: {
    es: "Vinculado a {challenges}",
    gl: "Vinculado a {challenges}",
    en: "Linked to {challenges}",
  },
  noLinkedChallenge: {
    es: "Ningún reto vinculado",
    gl: "Ningún reto vinculado",
    en: "No linked challenge",
  },
  unlinkedBadge: { es: "Sin vincular", gl: "Sen vincular", en: "Unlinked" },
  prizeRemoved: { es: "Premio eliminado.", gl: "Premio eliminado.", en: "Prize removed." },
  couldNotRemovePrize: {
    es: "No se ha podido eliminar el premio.",
    gl: "Non se puido eliminar o premio.",
    en: "Could not remove prize.",
  },
  memberRemoved: { es: "Miembro eliminado.", gl: "Membro eliminado.", en: "Member removed." },
  couldNotRemoveMember: {
    es: "No se ha podido eliminar el miembro.",
    gl: "Non se puido eliminar o membro.",
    en: "Could not remove member.",
  },
  participantDeleted: {
    es: "Participante eliminado.",
    gl: "Participante eliminado.",
    en: "Participant deleted.",
  },
  couldNotDeleteParticipant: {
    es: "No se ha podido eliminar el participante.",
    gl: "Non se puido eliminar o participante.",
    en: "Could not delete participant.",
  },
  verificationEmailSentLinked: {
    es: "Correo de verificación enviado a la dirección vinculada.",
    gl: "Correo de verificación enviado ao enderezo vinculado.",
    en: "Verification email sent to the linked address.",
  },
  couldNotLinkParticipant: {
    es: "No se ha podido vincular el participante al usuario.",
    gl: "Non se puido vincular o participante ao usuario.",
    en: "Could not link participant to user.",
  },
  linkParticipantToUser: {
    es: "Vincular participante a usuario",
    gl: "Vincular participante a usuario",
    en: "Link Participant to User",
  },
  userForEmail: { es: "Usuario para {email}", gl: "Usuario para {email}", en: "User for {email}" },
  selectUserPlaceholder: {
    es: "Selecciona un usuario",
    gl: "Selecciona un usuario",
    en: "Select user",
  },
  link: { es: "Vincular", gl: "Vincular", en: "Link" },
  addMemberLabel: { es: "Añadir miembro", gl: "Engadir membro", en: "Add member" },
  searchUsersNameEmailPlaceholder: {
    es: "Buscar usuarios por nombre o correo…",
    gl: "Buscar usuarios por nome ou correo…",
    en: "Search users by name or email…",
  },
  searchingEllipsis: { es: "Buscando…", gl: "Buscando…", en: "Searching…" },
  noMatchingUsersPeriod: {
    es: "No hay usuarios coincidentes.",
    gl: "Non hai usuarios coincidentes.",
    en: "No matching users.",
  },
  addAction: { es: "Añadir", gl: "Engadir", en: "Add" },
  memberAdded: { es: "Miembro añadido.", gl: "Membro engadido.", en: "Member added." },
  couldNotAddMember: {
    es: "No se ha podido añadir el miembro.",
    gl: "Non se puido engadir o membro.",
    en: "Could not add member.",
  },
  noChallengesAvailableAdd: {
    es: "No hay retos disponibles para añadir.",
    gl: "Non hai retos dispoñibles para engadir.",
    en: "No challenges available to add.",
  },
  addChallengeLabel: { es: "Añadir reto", gl: "Engadir reto", en: "Add challenge" },
  challengeAddedMsg: { es: "Reto añadido.", gl: "Reto engadido.", en: "Challenge added." },
  couldNotAddChallenge: {
    es: "No se ha podido añadir el reto.",
    gl: "Non se puido engadir o reto.",
    en: "Could not add challenge.",
  },

  // ---- Admin: CSV import ----
  couldNotReadFile: {
    es: "No se ha podido leer {file}.",
    gl: "Non se puido ler {file}.",
    en: "Could not read {file}.",
  },
  pastedLabel: { es: "Pegado", gl: "Pegado", en: "Pasted" },
  rowsCount: { es: "{count} filas", gl: "{count} filas", en: "{count} rows" },
  chooseCsv: { es: "Elegir CSV", gl: "Escoller CSV", en: "Choose CSV" },
  pasteRawCsvPlaceholder: {
    es: "…o pega aquí el texto CSV",
    gl: "…ou pega aquí o texto CSV",
    en: "…or paste the raw CSV text here",
  },
  create: { es: "Crear", gl: "Crear", en: "Create" },
  update: { es: "Actualizar", gl: "Actualizar", en: "Update" },
  colMembers: { es: "Miembros", gl: "Membros", en: "Members" },
  allMatched: { es: "Todo emparejado", gl: "Todo emparellado", en: "All matched" },
  unmatchedCount: {
    es: "{count} sin emparejar",
    gl: "{count} sen emparellar",
    en: "{count} unmatched",
  },
  provideBothCsvExports: {
    es: "Aporta las exportaciones CSV de proyectos y de participantes.",
    gl: "Achega as exportacións CSV de proxectos e de participantes.",
    en: "Provide both the projects and participants CSV exports.",
  },
  couldNotPreviewImport: {
    es: "No se ha podido previsualizar la importación.",
    gl: "Non se puido previsualizar a importación.",
    en: "Could not preview the import.",
  },
  importApplied: {
    es: "Importación aplicada.",
    gl: "Importación aplicada.",
    en: "Import applied.",
  },
  couldNotApplyImport: {
    es: "No se ha podido aplicar la importación.",
    gl: "Non se puido aplicar a importación.",
    en: "Could not apply the import.",
  },
  noAccessImportProjects: {
    es: "No puedes importar proyectos",
    gl: "Non podes importar proxectos",
    en: "You can't import projects",
  },
  importDeniedDesc: {
    es: "Importar requiere el permiso projects:import.",
    gl: "Importar require o permiso projects:import.",
    en: "Importing requires the projects:import capability.",
  },
  importCompleteTitle: {
    es: "Importación completa",
    gl: "Importación completa",
    en: "Import complete",
  },
  batchInline: { es: "Lote {id}", gl: "Lote {id}", en: "Batch {id}" },
  importAppliedTitle: {
    es: "Importación aplicada",
    gl: "Importación aplicada",
    en: "Import applied",
  },
  devpostWrittenDesc: {
    es: "Los envíos de Devpost se han escrito en hackOS.",
    gl: "Os envíos de Devpost escribíronse en hackOS.",
    en: "Devpost submissions were written into hackOS.",
  },
  colProjectsCreated: { es: "Proyectos creados", gl: "Proxectos creados", en: "Projects created" },
  colProjectsUpdated: {
    es: "Proyectos actualizados",
    gl: "Proxectos actualizados",
    en: "Projects updated",
  },
  colMembersMatched: {
    es: "Miembros emparejados",
    gl: "Membros emparellados",
    en: "Members matched",
  },
  colMembersUnmatched: {
    es: "Miembros sin emparejar",
    gl: "Membros sen emparellar",
    en: "Members unmatched",
  },
  colPrizesSeen: { es: "Premios detectados", gl: "Premios detectados", en: "Prizes seen" },
  participantsUnmatchedNoteOne: {
    es: "{count} participante no coincidió con ninguna cuenta. Resuélvelo en la página de sin emparejar.",
    gl: "{count} participante non coincidiu con ningunha conta. Resólveo na páxina de sen emparellar.",
    en: "{count} participant didn't match an account. Resolve them on the unmatched page.",
  },
  participantsUnmatchedNoteOther: {
    es: "{count} participantes no coincidieron con ninguna cuenta. Resuélvelos en la página de sin emparejar.",
    gl: "{count} participantes non coincidiron con ningunha conta. Resólveos na páxina de sen emparellar.",
    en: "{count} participants didn't match an account. Resolve them on the unmatched page.",
  },
  viewProjects: { es: "Ver proyectos", gl: "Ver proxectos", en: "View projects" },
  resolveUnmatched: {
    es: "Resolver sin emparejar",
    gl: "Resolver sen emparellar",
    en: "Resolve unmatched",
  },
  importAnother: { es: "Importar otro", gl: "Importar outro", en: "Import another" },
  reviewImport: { es: "Revisar importación", gl: "Revisar importación", en: "Review import" },
  reviewImportDesc: {
    es: "Todavía no se ha escrito nada. Confirma para aplicar este plan.",
    gl: "Aínda non se escribiu nada. Confirma para aplicar este plan.",
    en: "Nothing has been written yet. Confirm to apply this plan.",
  },
  back: { es: "Atrás", gl: "Atrás", en: "Back" },
  confirmImport: { es: "Confirmar importación", gl: "Confirmar importación", en: "Confirm import" },
  colProjectsLabel: { es: "Proyectos", gl: "Proxectos", en: "Projects" },
  newUpdateHint: {
    es: "{new} nuevos · {update} actualizados",
    gl: "{new} novos · {update} actualizados",
    en: "{new} new · {update} update",
  },
  matchedUnmatchedHint: {
    es: "{matched} emparejados · {unmatched} sin emparejar",
    gl: "{matched} emparellados · {unmatched} sen emparellar",
    en: "{matched} matched · {unmatched} unmatched",
  },
  prizesLabel: { es: "Premios", gl: "Premios", en: "Prizes" },
  unassignedRows: { es: "Filas sin asignar", gl: "Filas sen asignar", en: "Unassigned rows" },
  noProjectsParsed: {
    es: "No se ha procesado ningún proyecto",
    gl: "Non se procesou ningún proxecto",
    en: "No projects parsed",
  },
  devpostOptInPrizesDesc: {
    es: "Premios opcionales de Devpost y si ya se corresponden con un reto.",
    gl: "Premios opcionais de Devpost e se xa se corresponden cun reto.",
    en: "Devpost opt-in prizes and whether they already map to a challenge.",
  },
  projectCountOne: { es: "{count} proyecto", gl: "{count} proxecto", en: "{count} project" },
  projectCountOther: { es: "{count} proyectos", gl: "{count} proxectos", en: "{count} projects" },
  unmappedBadge: { es: "Sin mapear", gl: "Sen mapear", en: "Unmapped" },
  unassignedParticipantsTitle: {
    es: "Participantes sin asignar",
    gl: "Participantes sen asignar",
    en: "Unassigned participants",
  },
  unassignedParticipantsDesc: {
    es: "Filas de la exportación de participantes cuya referencia de proyecto no coincidió con ninguna fila de proyecto — no se importarán.",
    gl: "Filas da exportación de participantes cuxa referencia de proxecto non coincidiu con ningunha fila de proxecto — non se importarán.",
    en: "Rows in the participants export whose project reference matched no project row — they won't be imported.",
  },
  noTeamMembersPeriod: {
    es: "Sin miembros de equipo.",
    gl: "Sen membros de equipo.",
    en: "No team members.",
  },
  devpostExportsTitle: {
    es: "Exportaciones de Devpost",
    gl: "Exportacións de Devpost",
    en: "Devpost exports",
  },
  devpostExportsDesc: {
    es: "La exportación de proyectos (envíos) y la de participantes (inscritos).",
    gl: "A exportación de proxectos (envíos) e a de participantes (inscritos).",
    en: "The projects (submissions) export and the participants (registrants) export.",
  },
  previewImport: {
    es: "Previsualizar importación",
    gl: "Previsualizar importación",
    en: "Preview import",
  },
  projectsCsvLabel: { es: "CSV de proyectos", gl: "CSV de proxectos", en: "Projects CSV" },
  projectsCsvHint: {
    es: 'Exportación de "proyectos/envíos" de Devpost — columnas como Project Title, Submission Url, Opt-In Prizes, Team Member N Email.',
    gl: 'Exportación de "proxectos/envíos" de Devpost — columnas como Project Title, Submission Url, Opt-In Prizes, Team Member N Email.',
    en: 'Devpost "projects/submissions" export — columns like Project Title, Submission Url, Opt-In Prizes, Team Member N Email.',
  },
  participantsCsvLabel: {
    es: "CSV de participantes",
    gl: "CSV de participantes",
    en: "Participants CSV",
  },
  participantsCsvHint: {
    es: 'Exportación de "participantes/inscritos" de Devpost — columnas como Email, First Name, Last Name, Project URLs.',
    gl: 'Exportación de "participantes/inscritos" de Devpost — columnas como Email, First Name, Last Name, Project URLs.',
    en: 'Devpost "participants/registrants" export — columns like Email, First Name, Last Name, Project URLs.',
  },

  // ---- Admin: resolve unmatched imports ----
  couldNotLoadUnmatched: {
    es: "No se han podido cargar los participantes sin emparejar.",
    gl: "Non se puideron cargar os participantes sen emparellar.",
    en: "Could not load unmatched participants.",
  },
  couldNotSearchUsers: {
    es: "No se han podido buscar usuarios.",
    gl: "Non se puideron buscar usuarios.",
    en: "Could not search users.",
  },
  actionFailedGeneric: {
    es: "La acción ha fallado.",
    gl: "A acción fallou.",
    en: "Action failed.",
  },
  noAccessResolveImports: {
    es: "No puedes resolver importaciones",
    gl: "Non podes resolver importacións",
    en: "You can't resolve imports",
  },
  resolveImportsDeniedDesc: {
    es: "Resolver importaciones de Devpost requiere el permiso projects:import.",
    gl: "Resolver importacións de Devpost require o permiso projects:import.",
    en: "Resolving Devpost imports requires the projects:import capability.",
  },
  resolveUnmatchedDesc: {
    es: "Vincula participantes de Devpost importados a usuarios de hackOS o envía correos de reclamación de cuenta.",
    gl: "Vincula participantes de Devpost importados a usuarios de hackOS ou envía correos de reclamación de conta.",
    en: "Link imported Devpost participants to hackOS users or send account-claim emails.",
  },
  prizeMappingTitle: { es: "Mapeo de premios", gl: "Mapeo de premios", en: "Prize mapping" },
  prizeMappingDesc: {
    es: "Asocia un premio/etiqueta de Devpost a un reto de hackOS para que los proyectos importados aparezcan en las vistas de retos.",
    gl: "Asocia un premio/etiqueta de Devpost a un reto de hackOS para que os proxectos importados aparezan nas vistas de retos.",
    en: "Map a Devpost prize/tag to a hackOS challenge so imported projects appear in challenge views.",
  },
  prizeMapped: {
    es: "Premio asociado al reto.",
    gl: "Premio asociado ao reto.",
    en: "Prize mapped to challenge.",
  },
  mapPrize: { es: "Asociar premio", gl: "Asociar premio", en: "Map prize" },
  prizeNameLabel: { es: "Nombre del premio", gl: "Nome do premio", en: "Prize name" },
  exactDevpostPrizeNamePlaceholder: {
    es: "Nombre exacto del premio en Devpost",
    gl: "Nome exacto do premio en Devpost",
    en: "Exact Devpost prize name",
  },
  unmatchedParticipantsTitle: {
    es: "Participantes sin emparejar",
    gl: "Participantes sen emparellar",
    en: "Unmatched participants",
  },
  unmatchedParticipantsDesc: {
    es: "Participantes cuyo correo de Devpost no coincidió con ninguna cuenta de hackOS.",
    gl: "Participantes cuxo correo de Devpost non coincidiu con ningunha conta de hackOS.",
    en: "Participants whose Devpost email did not match a hackOS account.",
  },
  userSearchLabel: { es: "Buscar usuario", gl: "Buscar usuario", en: "User search" },
  searchUsersNameEmail: {
    es: "Buscar usuarios por nombre o correo",
    gl: "Buscar usuarios por nome ou correo",
    en: "Search users by name or email",
  },
  noUnmatchedParticipantsTitle: {
    es: "Sin participantes por emparejar",
    gl: "Sen participantes por emparellar",
    en: "No unmatched participants",
  },
  allImportedLinkedDesc: {
    es: "Todos los participantes importados de Devpost están vinculados a cuentas de hackOS.",
    gl: "Todos os participantes importados de Devpost están vinculados a contas de hackOS.",
    en: "All imported Devpost participants are linked to hackOS accounts.",
  },
  repoNameBatchInline: {
    es: "{repo} · lote {batch}",
    gl: "{repo} · lote {batch}",
    en: "{repo} · batch {batch}",
  },
  claimEmailSent: {
    es: "Correo de reclamación enviado",
    gl: "Correo de reclamación enviado",
    en: "Claim email sent",
  },
  unmatchedBadge: { es: "Sin emparejar", gl: "Sen emparellar", en: "Unmatched" },
  linkToUserLabel: { es: "Vincular a usuario", gl: "Vincular a usuario", en: "Link to user" },
  participantLinked: {
    es: "Participante vinculado.",
    gl: "Participante vinculado.",
    en: "Participant linked.",
  },
  claimEmailQueued: {
    es: "Correo de reclamación en cola.",
    gl: "Correo de reclamación en cola.",
    en: "Claim email queued.",
  },
  claimEmail: { es: "Correo de reclamación", gl: "Correo de reclamación", en: "Claim email" },

  // ---- Admin: judging criteria & question types ----
  typeNumeric010: { es: "Numérico 0-10", gl: "Numérico 0-10", en: "Numeric 0-10" },
  typeNumeric010Desc: {
    es: "Control deslizante o número de 0 a 10",
    gl: "Control desprazable ou número de 0 a 10",
    en: "Score slider or number from 0 to 10",
  },
  typeInteger: { es: "Entero", gl: "Enteiro", en: "Integer" },
  typeIntegerDesc: {
    es: "Entrada de número entero",
    gl: "Entrada de número enteiro",
    en: "Whole number input",
  },
  typeFloat: { es: "Decimal", gl: "Decimal", en: "Float" },
  typeFloatDesc: {
    es: "Entrada de número decimal",
    gl: "Entrada de número decimal",
    en: "Decimal number input",
  },
  typeShortText: { es: "Texto corto", gl: "Texto curto", en: "Short text" },
  typeShortTextDesc: {
    es: "Respuesta de una línea",
    gl: "Resposta dunha liña",
    en: "One-line text answer",
  },
  typeLongTextQ: { es: "Texto largo", gl: "Texto longo", en: "Long text" },
  typeLongTextDesc: {
    es: "Respuesta larga escrita",
    gl: "Resposta longa escrita",
    en: "Long written answer",
  },
  typeBoolean: { es: "Booleano", gl: "Booleano", en: "Boolean" },
  typeBooleanDesc: { es: "Respuesta sí o no", gl: "Resposta si ou non", en: "Yes or no answer" },
  typeSingleChoice: { es: "Opción única", gl: "Opción única", en: "Single choice" },
  typeSingleChoiceDesc: { es: "Solo una opción", gl: "Só unha opción", en: "One option only" },
  typeMultiChoice: { es: "Opción múltiple", gl: "Opción múltiple", en: "Multiple choice" },
  typeMultiChoiceDesc: {
    es: "Una o más casillas",
    gl: "Unha ou máis casas de verificación",
    en: "One or more checkbox options",
  },
  englishLabelRequiredQuestion: {
    es: "La pregunta «{key}» necesita una etiqueta en inglés.",
    gl: "A pregunta «{key}» precisa unha etiqueta en inglés.",
    en: 'Question "{key}" needs an English label.',
  },
  untitledFallback: { es: "sin título", gl: "sen título", en: "untitled" },
  optionEnglishLabelRequired: {
    es: "Una opción en «{key}» necesita una etiqueta en inglés.",
    gl: "Unha opción en «{key}» precisa unha etiqueta en inglés.",
    en: 'An option in "{key}" needs an English label.',
  },
  prizeLinkOptionalPlaceholder: {
    es: "Enlace (opcional)",
    gl: "Ligazón (opcional)",
    en: "Link (optional)",
  },
  prizeAriaName: {
    es: "Nombre del premio {index}",
    gl: "Nome do premio {index}",
    en: "Prize {index} name",
  },
  prizeAriaLink: {
    es: "Enlace del premio {index}",
    gl: "Ligazón do premio {index}",
    en: "Prize {index} link",
  },
  removePrizeAria: {
    es: "Quitar premio {index}",
    gl: "Quitar premio {index}",
    en: "Remove prize {index}",
  },
  addPrize: { es: "Añadir premio", gl: "Engadir premio", en: "Add prize" },
  addAnotherPrize: {
    es: "Añadir otro premio",
    gl: "Engadir outro premio",
    en: "Add another prize",
  },
  addField: { es: "Añadir campo", gl: "Engadir campo", en: "Add field" },
  moveFieldUp: { es: "Subir campo", gl: "Subir campo", en: "Move field up" },
  moveFieldDown: { es: "Bajar campo", gl: "Baixar campo", en: "Move field down" },
  removeField: { es: "Quitar campo", gl: "Quitar campo", en: "Remove field" },
  fieldKeyHint: {
    es: "El identificador exportado con las respuestas de este campo. Mantenlo estable para que las exportaciones sean consistentes.",
    gl: "O identificador exportado coas respostas deste campo. Manténo estable para que as exportacións sexan consistentes.",
    en: "The identifier exported with the answers for this field. Keep it stable so exports stay consistent.",
  },
  labelField: { es: "Etiqueta", gl: "Etiqueta", en: "Label" },
  requiredCheckboxLabel: { es: "Obligatorio", gl: "Obrigatorio", en: "Required" },
  judgesScoreScale: {
    es: "Los jueces puntúan en una escala de {min} a {max}.",
    gl: "Os xuíces puntúan nunha escala de {min} a {max}.",
    en: "Judges score this on a {min}–{max} scale.",
  },
  minimumLabel: { es: "Mínimo", gl: "Mínimo", en: "Minimum" },
  maximumLabel: { es: "Máximo", gl: "Máximo", en: "Maximum" },
  noLimitPlaceholder: { es: "Sin límite", gl: "Sen límite", en: "No limit" },
  maxLengthLabel: { es: "Longitud máxima", gl: "Lonxitude máxima", en: "Max length" },
  optionsFieldLabel: { es: "Opciones", gl: "Opcións", en: "Options" },
  addOptionButton: { es: "Añadir opción", gl: "Engadir opción", en: "Add option" },
  optionNumberLabel: { es: "Opción {index}", gl: "Opción {index}", en: "Option {index}" },
  hideTranslations: {
    es: "Ocultar traducciones",
    gl: "Ocultar traducións",
    en: "Hide translations",
  },
  addTranslations: { es: "Añadir traducciones", gl: "Engadir traducións", en: "Add translations" },
  removeOptionAria: {
    es: "Quitar opción {index}",
    gl: "Quitar opción {index}",
    en: "Remove option {index}",
  },
  valueTag: { es: "Valor", gl: "Valor", en: "Value" },
  valueHint: {
    es: "El identificador exportado cuando un juez elige esta opción. Mantenlo estable para que las exportaciones sean consistentes.",
    gl: "O identificador exportado cando un xuíz escolle esta opción. Manténo estable para que as exportacións sexan consistentes.",
    en: "The identifier exported when a judge picks this option. Keep it stable so exports stay consistent.",
  },
  englishTag: { es: "Inglés", gl: "Inglés", en: "English" },
  optionAriaValue: {
    es: "Valor de la opción {index}",
    gl: "Valor da opción {index}",
    en: "Option {index} value",
  },
  optionAriaLabel: {
    es: "Etiqueta de la opción {index}",
    gl: "Etiqueta da opción {index}",
    en: "Option {index} label",
  },
  spanishTag: { es: "Español", gl: "Castelán", en: "Spanish" },
  galicianTag: { es: "Gallego", gl: "Galego", en: "Galician" },
  defaultsToEnglishPlaceholder: {
    es: "Por defecto, en inglés",
    gl: "Por defecto, en inglés",
    en: "Defaults to English",
  },
  optionalSuffix: { es: " (opcional)", gl: " (opcional)", en: " (optional)" },
  moreInformationAria: { es: "Más información", gl: "Máis información", en: "More information" },
  couldNotLoadChallenges: {
    es: "No se han podido cargar los retos.",
    gl: "Non se puideron cargar os retos.",
    en: "Could not load challenges.",
  },
  madeVisibleOne: {
    es: "Se ha hecho visible {count} reto.",
    gl: "Fíxose visible {count} reto.",
    en: "Made {count} challenge visible.",
  },
  madeVisibleOther: {
    es: "Se han hecho visibles {count} retos.",
    gl: "Fixéronse visibles {count} retos.",
    en: "Made {count} challenges visible.",
  },
  hidCountOne: {
    es: "Se ha ocultado {count} reto.",
    gl: "Ocultouse {count} reto.",
    en: "Hid {count} challenge.",
  },
  hidCountOther: {
    es: "Se han ocultado {count} retos.",
    gl: "Ocultáronse {count} retos.",
    en: "Hid {count} challenges.",
  },
  noAccessChallenges: {
    es: "No puedes acceder a los retos",
    gl: "Non podes acceder aos retos",
    en: "You can't access challenges",
  },
  challengesAccessDeniedDesc: {
    es: "El acceso a los retos está disponible para administradores y representantes de patrocinadores vinculados.",
    gl: "O acceso aos retos está dispoñible para administradores e representantes de patrocinadores vinculados.",
    en: "Challenge access is available to admins and linked sponsor representatives.",
  },
  myChallenges: { es: "Mis retos", gl: "Os meus retos", en: "My challenges" },
  challengesDesc: {
    es: "Contenido del reto, premios, configuración del panel de jueces y publicación pública.",
    gl: "Contido do reto, premios, configuración do panel de xuíces e publicación pública.",
    en: "Challenge content, prizes, judging panel configuration and public reveal.",
  },
  newChallenge: { es: "Nuevo reto", gl: "Novo reto", en: "New challenge" },
  colChallenge: { es: "Reto", gl: "Reto", en: "Challenge" },
  colReveal: { es: "Publicación", gl: "Publicación", en: "Reveal" },
  searchChallengesPlaceholder: {
    es: "Buscar retos…",
    gl: "Buscar retos…",
    en: "Search challenges…",
  },
  makeVisible: { es: "Hacer visible", gl: "Facer visible", en: "Make visible" },
  noChallengesYetTitle: {
    es: "Aún no hay retos",
    gl: "Aínda non hai retos",
    en: "No challenges yet",
  },
  createFirstEnterpriseChallenge: {
    es: "Crea la primera plantilla de reto de empresa.",
    gl: "Crea o primeiro modelo de reto de empresa.",
    en: "Create the first enterprise challenge template.",
  },
  noChallengeAssignedYet: {
    es: "Tu empresa todavía no tiene ningún reto asignado.",
    gl: "A túa empresa aínda non ten ningún reto asignado.",
    en: "Your enterprise has no challenge assigned yet.",
  },
  couldNotLoadChallengeData: {
    es: "No se han podido cargar los datos del reto.",
    gl: "Non se puideron cargar os datos do reto.",
    en: "Could not load challenge data.",
  },
  englishTitleRequired: {
    es: "Se requiere un título en inglés.",
    gl: "Requírese un título en inglés.",
    en: "An English title is required.",
  },
  challengeCreated: { es: "Reto creado.", gl: "Reto creado.", en: "Challenge created." },
  checkBuilderFields: {
    es: "Revisa los campos del constructor e inténtalo de nuevo.",
    gl: "Revisa os campos do construtor e téntao de novo.",
    en: "Check the builder fields and try again.",
  },
  createChallenge: { es: "Crear reto", gl: "Crear reto", en: "Create challenge" },
  selectEnterprisePlaceholder: {
    es: "Selecciona una empresa",
    gl: "Selecciona unha empresa",
    en: "Select an enterprise",
  },
  publicCriteria: { es: "Criterios públicos", gl: "Criterios públicos", en: "Public criteria" },
  judgingPanel: { es: "Panel de jueces", gl: "Panel de xuíces", en: "Judging panel" },
  maxPresentationTime: {
    es: "Tiempo máximo de presentación",
    gl: "Tempo máximo de presentación",
    en: "Max presentation time",
  },
  waitingRoomCapacity: {
    es: "Capacidad de la sala de espera",
    gl: "Capacidade da sala de espera",
    en: "Waiting room capacity",
  },
  publishDate: { es: "Fecha de publicación", gl: "Data de publicación", en: "Publish date" },
  addPublishDate: {
    es: "Añadir fecha de publicación",
    gl: "Engadir data de publicación",
    en: "Add publish date",
  },
  publishDateTime: {
    es: "Fecha y hora de publicación",
    gl: "Data e hora de publicación",
    en: "Publish date and time",
  },
  couldNotLoadChallenge: {
    es: "No se ha podido cargar este reto.",
    gl: "Non se puido cargar este reto.",
    en: "Could not load this challenge.",
  },
  challengeNotFoundTitle: {
    es: "Reto no encontrado",
    gl: "Reto non atopado",
    en: "Challenge not found",
  },
  challengeNotLoadedDesc: {
    es: "Este reto no se ha podido cargar.",
    gl: "Este reto non se puido cargar.",
    en: "This challenge could not be loaded.",
  },
  backToChallenges: { es: "Volver a retos", gl: "Volver a retos", en: "Back to challenges" },
  challengeUpdated: { es: "Reto actualizado.", gl: "Reto actualizado.", en: "Challenge updated." },
  editPublicContentDesc: {
    es: "Edita el contenido público, los premios y la configuración del panel de jueces.",
    gl: "Edita o contido público, os premios e a configuración do panel de xuíces.",
    en: "Edit public content, prizes and the judging panel configuration.",
  },
  visibleLabel: { es: "Visible", gl: "Visible", en: "Visible" },
  importedDevpostPrizesTitle: {
    es: "Premios de DevPost importados",
    gl: "Premios de DevPost importados",
    en: "Imported DevPost prizes",
  },
  importedDevpostPrizesDesc: {
    es: "Datos de referencia del último lote de importación. Las etiquetas seleccionadas en este reto deciden quién entra en la cola.",
    gl: "Datos de referencia do último lote de importación. As etiquetas seleccionadas neste reto deciden quen entra na cola.",
    en: "Reference data from the latest import batch. Selected tags on this challenge decide who enters the queue.",
  },
  mappedToInline: { es: "Asociado a {title}", gl: "Asociado a {title}", en: "Mapped to {title}" },

  // ---- Admin: sponsors & enterprises ----
  colWebsite: { es: "Sitio web", gl: "Sitio web", en: "Website" },
  scheduled: { es: "Programado", gl: "Programado", en: "Scheduled" },
  priorityLabel: { es: "Prioridad", gl: "Prioridade", en: "Priority" },
  myEnterprise: { es: "Mi empresa", gl: "A miña empresa", en: "My enterprise" },
  loadingEnterprise: { es: "Cargando empresa", gl: "Cargando empresa", en: "Loading enterprise" },
  noAccessSponsors: {
    es: "No puedes gestionar patrocinadores",
    gl: "Non podes xestionar patrocinadores",
    en: "You can't manage sponsors",
  },
  sponsorsAccessDeniedDesc: {
    es: "Necesitas el permiso sponsors:manage para ver y gestionar empresas.",
    gl: "Precisas o permiso sponsors:manage para ver e xestionar empresas.",
    en: "You need the sponsors:manage capability to view and manage enterprises.",
  },
  couldNotLoadEnterprises: {
    es: "No se han podido cargar las empresas.",
    gl: "Non se puideron cargar as empresas.",
    en: "Could not load enterprises.",
  },
  madeVisibleEnterpriseOne: {
    es: "Se ha hecho visible {count} empresa.",
    gl: "Fíxose visible {count} empresa.",
    en: "Made {count} enterprise visible.",
  },
  madeVisibleEnterpriseOther: {
    es: "Se han hecho visibles {count} empresas.",
    gl: "Fixéronse visibles {count} empresas.",
    en: "Made {count} enterprises visible.",
  },
  hidEnterpriseOne: {
    es: "Se ha ocultado {count} empresa.",
    gl: "Ocultouse {count} empresa.",
    en: "Hid {count} enterprise.",
  },
  hidEnterpriseOther: {
    es: "Se han ocultado {count} empresas.",
    gl: "Ocultáronse {count} empresas.",
    en: "Hid {count} enterprises.",
  },
  couldNotLoadYourEnterprise: {
    es: "No se ha podido cargar tu empresa.",
    gl: "Non se puido cargar a túa empresa.",
    en: "Could not load your enterprise.",
  },
  enterprisesDesc: {
    es: "Organizaciones patrocinadoras. Crea una antes de invitar a sus representantes — se vincularán automáticamente al aceptar.",
    gl: "Organizacións patrocinadoras. Crea unha antes de convidar aos seus representantes — vincularanse automaticamente ao aceptar.",
    en: "Sponsor organisations. Create one before inviting its representatives — they auto-link on acceptance.",
  },
  newEnterprise: { es: "Nueva empresa", gl: "Nova empresa", en: "New enterprise" },
  searchEnterprisesPlaceholder: {
    es: "Buscar empresas…",
    gl: "Buscar empresas…",
    en: "Search enterprises…",
  },
  noEnterprisesYetTitle: {
    es: "Aún no hay empresas",
    gl: "Aínda non hai empresas",
    en: "No enterprises yet",
  },
  createFirstSponsorEnterprise: {
    es: "Crea la primera empresa patrocinadora para empezar.",
    gl: "Crea a primeira empresa patrocinadora para comezar.",
    en: "Create the first sponsor enterprise to get started.",
  },
  enterpriseCreated: { es: "Empresa creada.", gl: "Empresa creada.", en: "Enterprise created." },
  couldNotCreateEnterprise: {
    es: "No se ha podido crear la empresa.",
    gl: "Non se puido crear a empresa.",
    en: "Could not create the enterprise.",
  },
  newEnterpriseModalDesc: {
    es: "Añade una organización patrocinadora. Podrás perfeccionar su perfil y logo después.",
    gl: "Engade unha organización patrocinadora. Poderás perfeccionar o seu perfil e logo despois.",
    en: "Add a sponsor organisation. You can refine its profile and logo afterwards.",
  },
  createEnterprise: { es: "Crear empresa", gl: "Crear empresa", en: "Create enterprise" },
  acmeCorpPlaceholder: { es: "Acme Corp", gl: "Acme Corp", en: "Acme Corp" },
  websiteLabel: { es: "Sitio web", gl: "Sitio web", en: "Website" },
  logoUrlLabel: { es: "URL del logo", gl: "URL do logo", en: "Logo URL" },
  optionalUploadLater: {
    es: "Opcional — también puedes subir un logo más tarde.",
    gl: "Opcional — tamén podes subir un logo máis tarde.",
    en: "Optional — you can also upload a logo later.",
  },
  darkBackgroundLogoUrlLabel: {
    es: "URL del logo para fondos oscuros",
    gl: "URL do logo para fondos escuros",
    en: "Logo for dark backgrounds URL",
  },
  regularLogoUsedDesc: {
    es: "Opcional — se usa el logo normal cuando esto está vacío.",
    gl: "Opcional — úsase o logo normal cando isto está baleiro.",
    en: "Optional — the regular logo is used when this is blank.",
  },
  whatSponsorDoesPlaceholder: {
    es: "A qué se dedica este patrocinador…",
    gl: "A que se dedica este patrocinador…",
    en: "What this sponsor does…",
  },
  tierIdLabel: { es: "ID de nivel", gl: "ID de nivel", en: "Tier ID" },
  tierReferenceOptionalDesc: {
    es: "Referencia del nivel del patrocinador (opcional).",
    gl: "Referencia do nivel do patrocinador (opcional).",
    en: "Sponsor tier reference (optional).",
  },
  displayPriorityLabel: {
    es: "Prioridad de visualización",
    gl: "Prioridade de visualización",
    en: "Display priority",
  },
  lowerShowsFirstDesc: {
    es: "Un valor más bajo se muestra primero en la revelación.",
    gl: "Un valor máis baixo móstrase primeiro na revelación.",
    en: "Lower shows first in the reveal.",
  },
  revealFromLabel: { es: "Se revela desde", gl: "Revélase desde", en: "Reveal from" },
  addRevealTimeField: {
    es: "Añadir hora de revelación",
    gl: "Engadir hora de revelación",
    en: "Add reveal time",
  },
  revealDateTime: {
    es: "Fecha y hora de revelación",
    gl: "Data e hora de revelación",
    en: "Reveal date and time",
  },
  enterpriseNotFoundTitle: {
    es: "Empresa no encontrada",
    gl: "Empresa non atopada",
    en: "Enterprise not found",
  },
  enterpriseNotLoadedDesc: {
    es: "Esta empresa no se ha podido cargar.",
    gl: "Esta empresa non se puido cargar.",
    en: "This enterprise could not be loaded.",
  },
  backToEnterprises: {
    es: "Volver a empresas",
    gl: "Volver a empresas",
    en: "Back to enterprises",
  },
  needUsersReadSearch: {
    es: "Necesitas el permiso users:read para buscar usuarios.",
    gl: "Precisas o permiso users:read para buscar usuarios.",
    en: "You need users:read to search users.",
  },
  searchFailedGeneric: {
    es: "La búsqueda ha fallado.",
    gl: "A busca fallou.",
    en: "Search failed.",
  },
  userAffiliated: { es: "Usuario afiliado.", gl: "Usuario afiliado.", en: "User affiliated." },
  couldNotAddUser: {
    es: "No se ha podido añadir este usuario.",
    gl: "Non se puido engadir este usuario.",
    en: "Could not add this user.",
  },
  affiliationRemoved: {
    es: "Afiliación eliminada.",
    gl: "Afiliación eliminada.",
    en: "Affiliation removed.",
  },
  couldNotRemoveUser: {
    es: "No se ha podido eliminar este usuario.",
    gl: "Non se puido eliminar este usuario.",
    en: "Could not remove this user.",
  },
  affiliatedUsersTitle: {
    es: "Usuarios afiliados",
    gl: "Usuarios afiliados",
    en: "Affiliated users",
  },
  affiliatedUsersDesc: {
    es: "Personas vinculadas a esta empresa (representantes del patrocinador).",
    gl: "Persoas vinculadas a esta empresa (representantes do patrocinador).",
    en: "People linked to this enterprise (sponsor representatives).",
  },
  searchUserByNameEmail: {
    es: "Buscar un usuario por nombre o correo…",
    gl: "Buscar un usuario por nome ou correo…",
    en: "Search a user by name or email…",
  },
  noAffiliatedUsersTitle: {
    es: "Aún no hay usuarios afiliados",
    gl: "Aínda non hai usuarios afiliados",
    en: "No affiliated users yet",
  },
  searchAboveToAffiliate: {
    es: "Busca arriba para afiliar a alguien a esta empresa.",
    gl: "Busca arriba para afiliar a alguén a esta empresa.",
    en: "Search above to affiliate someone with this enterprise.",
  },
  unsupportedFileType: {
    es: "Tipo de archivo no compatible. Usa PNG, JPEG, WebP, SVG o GIF.",
    gl: "Tipo de ficheiro non compatible. Usa PNG, JPEG, WebP, SVG ou GIF.",
    en: "Unsupported file type. Use PNG, JPEG, WebP, SVG or GIF.",
  },
  darkLogoUpdated: {
    es: "Logo para fondos oscuros actualizado.",
    gl: "Logo para fondos escuros actualizado.",
    en: "Dark-background logo updated.",
  },
  logoUpdated: { es: "Logo actualizado.", gl: "Logo actualizado.", en: "Logo updated." },
  couldNotUploadLogo: {
    es: "No se ha podido subir el logo.",
    gl: "Non se puido subir o logo.",
    en: "Could not upload the logo.",
  },
  logoTitle: { es: "Logo", gl: "Logo", en: "Logo" },
  logoDesc: {
    es: "Sube un logo estándar y, opcionalmente, uno alternativo para fondos oscuros.",
    gl: "Sube un logo estándar e, opcionalmente, un alternativo para fondos escuros.",
    en: "Upload a standard logo and, optionally, an alternate logo for dark backgrounds.",
  },
  replaceLogo: { es: "Cambiar logo", gl: "Cambiar logo", en: "Replace logo" },
  uploadLogo: { es: "Subir logo", gl: "Subir logo", en: "Upload logo" },
  uploadDarkLogo: {
    es: "Subir logo para fondos oscuros",
    gl: "Subir logo para fondos escuros",
    en: "Upload dark-background logo",
  },
  replaceDarkLogo: {
    es: "Cambiar logo para fondos oscuros",
    gl: "Cambiar logo para fondos escuros",
    en: "Replace dark-background logo",
  },
  profileTitle: { es: "Perfil", gl: "Perfil", en: "Profile" },
  editSponsorDetailsDesc: {
    es: "Edita los datos de este patrocinador. Los cambios quedan registrados en el registro de auditoría.",
    gl: "Edita os datos deste patrocinador. Os cambios quedan rexistrados no rexistro de auditoría.",
    en: "Edit this sponsor's details. Changes are recorded in the audit log.",
  },
  contactStaffToChangeName: {
    es: "Contacta con el equipo para cambiar el nombre legal.",
    gl: "Contacta co equipo para cambiar o nome legal.",
    en: "Contact staff to change the legal name.",
  },
  setDirectlyOrUpload: {
    es: "Establécelo directamente o usa el cargador de arriba (que lo rellena).",
    gl: "Estabelécea directamente ou usa o cargador de arriba (que a completa).",
    en: "Set directly, or use the uploader above (which fills this in).",
  },
  optionalStandardLogoUsedDesc: {
    es: "Opcional. El logo estándar se usa en ambos temas cuando se deja en blanco.",
    gl: "Opcional. O logo estándar úsase en ambos os temas cando se deixa en branco.",
    en: "Optional. The standard logo is used in both themes when left blank.",
  },
  couldNotSaveEnterprise: {
    es: "No se ha podido guardar la empresa.",
    gl: "Non se puido gardar a empresa.",
    en: "Could not save the enterprise.",
  },

  // ---- Admin: permission groups ----
  couldNotLoadPermissionGroups: {
    es: "No se han podido cargar los grupos de permisos.",
    gl: "Non se puideron cargar os grupos de permisos.",
    en: "Could not load permission groups.",
  },
  groupCreated: { es: "Grupo creado.", gl: "Grupo creado.", en: "Group created." },
  couldNotCreateGroup: {
    es: "No se ha podido crear el grupo.",
    gl: "Non se puido crear o grupo.",
    en: "Could not create the group.",
  },
  noDescriptionItalic: { es: "Sin descripción", gl: "Sen descrición", en: "No description" },
  permissionsDesc: {
    es: "Los grupos otorgan conjuntos de permisos y pueden incluir otros grupos.",
    gl: "Os grupos outorgan conxuntos de permisos e poden incluír outros grupos.",
    en: "Groups grant sets of capabilities and can include other groups.",
  },
  newGroup: { es: "Nuevo grupo", gl: "Novo grupo", en: "New group" },
  clickGroupToEditDesc: {
    es: "Haz clic en un grupo para editar sus permisos, miembros y grupos anidados.",
    gl: "Fai clic nun grupo para editar os seus permisos, membros e grupos aniñados.",
    en: "Click a group to edit its capabilities, members and nested groups.",
  },
  filterGroupsPlaceholder: { es: "Filtrar grupos…", gl: "Filtrar grupos…", en: "Filter groups…" },
  noPermissionGroupsYetTitle: {
    es: "Aún no hay grupos de permisos",
    gl: "Aínda non hai grupos de permisos",
    en: "No permission groups yet",
  },
  createGroupToStart: {
    es: "Crea un grupo para empezar a asignar permisos.",
    gl: "Crea un grupo para comezar a asignar permisos.",
    en: "Create a group to start assigning capabilities.",
  },
  capabilitiesCatalogueTitle: {
    es: "Catálogo de permisos",
    gl: "Catálogo de permisos",
    en: "Capabilities catalogue",
  },
  capabilitiesCatalogueDesc: {
    es: "Todos los tipos de permiso que existen, agrupados por dominio. Referencia de solo lectura.",
    gl: "Todos os tipos de permiso que existen, agrupados por dominio. Referencia de só lectura.",
    en: "Every capability kind there is, grouped by domain. Read-only reference.",
  },
  newPermissionGroupTitle: {
    es: "Nuevo grupo de permisos",
    gl: "Novo grupo de permisos",
    en: "New permission group",
  },
  giveNameOptionalCapsDesc: {
    es: "Dale un nombre y, opcionalmente, los permisos que otorga.",
    gl: "Dálle un nome e, opcionalmente, os permisos que outorga.",
    en: "Give it a name and, optionally, the capabilities it grants.",
  },
  createGroup: { es: "Crear grupo", gl: "Crear grupo", en: "Create group" },
  whatGroupForPlaceholder: {
    es: "Para qué sirve este grupo…",
    gl: "Para que serve este grupo…",
    en: "What this group is for…",
  },
  capabilitiesLabel: { es: "Permisos", gl: "Permisos", en: "Capabilities" },
  selectCapabilitiesPlaceholder: {
    es: "Selecciona permisos…",
    gl: "Selecciona permisos…",
    en: "Select capabilities…",
  },
  searchCapabilitiesPlaceholder: {
    es: "Buscar permisos…",
    gl: "Buscar permisos…",
    en: "Search capabilities…",
  },
  noMatchingCapability: {
    es: "Ningún permiso coincidente.",
    gl: "Ningún permiso coincidente.",
    en: "No matching capability.",
  },
  canChangeLaterDesc: {
    es: "También puedes cambiarlos más tarde.",
    gl: "Tamén podes cambialos máis tarde.",
    en: "You can also change these later.",
  },
  couldNotLoadGroup: {
    es: "No se ha podido cargar el grupo.",
    gl: "Non se puido cargar o grupo.",
    en: "Could not load the group.",
  },
  groupUpdated: { es: "Grupo actualizado.", gl: "Grupo actualizado.", en: "Group updated." },
  couldNotSaveGroup: {
    es: "No se ha podido guardar el grupo.",
    gl: "Non se puido gardar o grupo.",
    en: "Could not save the group.",
  },
  capabilitiesSaved: {
    es: "Permisos guardados.",
    gl: "Permisos gardados.",
    en: "Capabilities saved.",
  },
  couldNotSaveCapabilities: {
    es: "No se han podido guardar los permisos.",
    gl: "Non se puideron gardar os permisos.",
    en: "Could not save capabilities.",
  },
  groupIncluded: { es: "Grupo incluido.", gl: "Grupo incluído.", en: "Group included." },
  couldNotIncludeGroup: {
    es: "No se ha podido incluir el grupo.",
    gl: "Non se puido incluír o grupo.",
    en: "Could not include the group.",
  },
  couldNotRemoveIncludedGroup: {
    es: "No se ha podido quitar el grupo incluido.",
    gl: "Non se puido quitar o grupo incluído.",
    en: "Could not remove the included group.",
  },
  couldNotAddMemberGroup: {
    es: "No se ha podido añadir al miembro.",
    gl: "Non se puido engadir o membro.",
    en: "Could not add the member.",
  },
  couldNotRemoveMemberGroup: {
    es: "No se ha podido quitar al miembro.",
    gl: "Non se puido quitar o membro.",
    en: "Could not remove the member.",
  },
  groupDeleted: { es: "Grupo eliminado.", gl: "Grupo eliminado.", en: "Group deleted." },
  couldNotDeleteGroup: {
    es: "No se ha podido eliminar el grupo.",
    gl: "Non se puido eliminar o grupo.",
    en: "Could not delete the group.",
  },
  groupNumberFallback: { es: "Grupo #{id}", gl: "Grupo #{id}", en: "Group #{id}" },
  groupNotFoundTitle: { es: "Grupo no encontrado", gl: "Grupo non atopado", en: "Group not found" },
  groupNotFoundDesc: {
    es: "Este grupo de permisos ya no existe.",
    gl: "Este grupo de permisos xa non existe.",
    en: "This permission group no longer exists.",
  },
  backToPermissions: {
    es: "Volver a permisos",
    gl: "Volver a permisos",
    en: "Back to permissions",
  },
  noDescriptionPeriod: { es: "Sin descripción.", gl: "Sen descrición.", en: "No description." },
  groupDetailsTitle: { es: "Datos del grupo", gl: "Datos do grupo", en: "Group details" },
  renameOrUpdateDescDesc: {
    es: "Cambia el nombre del grupo o actualiza su descripción.",
    gl: "Cambia o nome do grupo ou actualiza a súa descrición.",
    en: "Rename the group or update its description.",
  },
  capabilitiesGrantDesc: {
    es: "Los permisos que este grupo otorga a sus miembros.",
    gl: "Os permisos que este grupo outorga aos seus membros.",
    en: "The capabilities this group grants to its members.",
  },
  saveCapabilities: { es: "Guardar permisos", gl: "Gardar permisos", en: "Save capabilities" },
  membersTitle: { es: "Miembros", gl: "Membros", en: "Members" },
  usersInGroupDesc: {
    es: "Usuarios que pertenecen directamente a este grupo.",
    gl: "Usuarios que pertencen directamente a este grupo.",
    en: "Users who belong to this group directly.",
  },
  noMembersYetPeriod: {
    es: "Aún no hay miembros.",
    gl: "Aínda non hai membros.",
    en: "No members yet.",
  },
  userNumberFallback: { es: "Usuario #{id}", gl: "Usuario #{id}", en: "User #{id}" },
  removeMemberAria: {
    es: "Quitar al miembro {id}",
    gl: "Quitar o membro {id}",
    en: "Remove member {id}",
  },
  includedGroupsTitle: { es: "Grupos incluidos", gl: "Grupos incluídos", en: "Included groups" },
  membersInheritDesc: {
    es: "Los miembros heredan los permisos de cada grupo incluido (sin ciclos).",
    gl: "Os membros heredan os permisos de cada grupo incluído (sen ciclos).",
    en: "Members inherit the capabilities of every included group (no cycles).",
  },
  includeGroupPlaceholder: {
    es: "Incluir un grupo…",
    gl: "Incluír un grupo…",
    en: "Include a group…",
  },
  noIncludedGroupsPeriod: {
    es: "Ningún grupo incluido.",
    gl: "Ningún grupo incluído.",
    en: "No included groups.",
  },
  removeIncludedGroupAria: {
    es: "Quitar el grupo incluido {id}",
    gl: "Quitar o grupo incluído {id}",
    en: "Remove included group {id}",
  },
  dangerZoneTitle: { es: "Zona de peligro", gl: "Zona de perigo", en: "Danger zone" },
  deletingGroupRemovesDesc: {
    es: "Eliminar un grupo lo quita de todos los miembros y grupos superiores.",
    gl: "Eliminar un grupo quítao de todos os membros e grupos superiores.",
    en: "Deleting a group removes it from every member and parent group.",
  },
  deleteGroup: { es: "Eliminar grupo", gl: "Eliminar grupo", en: "Delete group" },
  cannotBeUndoneMembersLose: {
    es: "Esto no se puede deshacer. Los miembros perderán los permisos que este grupo les otorgaba.",
    gl: "Isto non se pode desfacer. Os membros perderán os permisos que este grupo lles outorgaba.",
    en: "This cannot be undone. Members lose the capabilities this group granted them.",
  },
  deleteGroupQuestionInline: {
    es: "¿Eliminar «{name}»?",
    gl: "Eliminar «{name}»?",
    en: 'Delete "{name}"?',
  },
  permanentlyRemovesGroupDesc: {
    es: "Esto elimina permanentemente el grupo y sus asignaciones.",
    gl: "Isto elimina permanentemente o grupo e as súas asignacións.",
    en: "This permanently removes the group and its assignments.",
  },
  typeFreeConfirmInline: {
    es: "Confirmación sin escritura: haz clic en eliminar para quitar {name}.",
    gl: "Confirmación sen escritura: fai clic en eliminar para quitar {name}.",
    en: "Type-free confirmation: click delete to remove {name}.",
  },
  searchDirectoryDesc: {
    es: "Busca en el directorio de usuarios por nombre o correo.",
    gl: "Busca no directorio de usuarios por nome ou correo.",
    en: "Search the user directory by name or email.",
  },
  searchUsersEllipsisPlaceholder: {
    es: "Buscar usuarios…",
    gl: "Buscar usuarios…",
    en: "Search users…",
  },
  noUsersFoundPeriod: {
    es: "No se han encontrado usuarios.",
    gl: "Non se atoparon usuarios.",
    en: "No users found.",
  },
  added: { es: "Añadido", gl: "Engadido", en: "Added" },

  // ---- Admin: event settings ----
  couldNotLoadEventSettings: {
    es: "No se ha podido cargar la configuración del evento.",
    gl: "Non se puido cargar a configuración do evento.",
    en: "Could not load event settings.",
  },
  eventSettingsSaved: {
    es: "Configuración del evento guardada.",
    gl: "Configuración do evento gardada.",
    en: "Event settings saved.",
  },
  couldNotSaveEventSettings: {
    es: "No se ha podido guardar la configuración del evento.",
    gl: "Non se puido gardar a configuración do evento.",
    en: "Could not save event settings.",
  },
  eventTitle: { es: "Evento", gl: "Evento", en: "Event" },
  eventDesc: {
    es: "Identidad del evento: nombre, eslogan y zona horaria.",
    gl: "Identidade do evento: nome, eslogan e fuso horario.",
    en: "The event's identity: name, tagline and timezone.",
  },
  taglineLabel: { es: "Eslogan", gl: "Eslogan", en: "Tagline" },
  taglineShortLinePlaceholder: {
    es: "Una línea breve que se muestra junto al nombre",
    gl: "Unha liña breve que se amosa xunto ao nome",
    en: "A short line shown alongside the name",
  },
  timezoneLabel: { es: "Zona horaria", gl: "Fuso horario", en: "Timezone" },
  timezoneHintDesc: {
    es: "Nombre de zona horaria IANA (p. ej. Europe/Madrid). Configura las horas del hackathon desde una máquina en esta zona — los campos de abajo usan la hora local de tu navegador.",
    gl: "Nome de fuso horario IANA (p. ex. Europe/Madrid). Configura as horas do hackathon desde unha máquina nesta zona — os campos de abaixo usan a hora local do teu navegador.",
    en: "IANA timezone name (e.g. Europe/Madrid). Set the hacking times from a machine in this zone — the fields below use your browser's local time.",
  },
  scheduleSectionTitle: { es: "Horario", gl: "Horario", en: "Schedule" },
  scheduleSectionDesc: {
    es: "Apertura de puertas y ventana de hacking. La ventana de hacking controla la cuenta atrás en la web y las pantallas de TV.",
    gl: "Apertura de portas e ventá de hacking. A ventá de hacking controla a conta atrás na web e nas pantallas de TV.",
    en: "Doors open and the hacking window. The hacking window drives the countdown on the website and TV panels.",
  },
  eventStartsLabel: {
    es: "Empieza el evento (apertura de puertas)",
    gl: "Comeza o evento (apertura de portas)",
    en: "Event starts (doors open)",
  },
  eventStartsDesc: {
    es: "Cuándo pueden llegar los asistentes a la sede. Esta es la hora que aparece en el pase de Apple Wallet — no tiene por qué coincidir con el inicio del hacking.",
    gl: "Cando poden chegar os asistentes á sede. Esta é a hora que aparece no pase de Apple Wallet — non ten por que coincidir co inicio do hacking.",
    en: "When attendees can arrive at the venue. This is the time shown on the Apple Wallet pass — it need not match the hacking start.",
  },
  eventEndsLabel: {
    es: "Termina el evento",
    gl: "Remata o evento",
    en: "Event ends",
  },
  eventEndsDesc: {
    es: "Cuándo acaba el evento (no el hacking — en eventos de varios días no coinciden). El pase de Apple Wallet caduca a esta hora y Wallet deja de mostrarlo.",
    gl: "Cando remata o evento (non o hacking — en eventos de varios días non coinciden). O pase de Apple Wallet caduca a esta hora e Wallet deixa de amosalo.",
    en: "When the event is over (not the hacking end — on multi-day events they differ). The Apple Wallet pass expires then and Wallet stops surfacing it.",
  },
  hackingStartsLabel: {
    es: "Empieza el hacking",
    gl: "Comeza o hacking",
    en: "Hacking starts",
  },
  hackingStartsDesc: {
    es: "Cuándo arranca el reloj del hackathon (la cuenta atrás pública).",
    gl: "Cando arrinca o reloxo do hackathon (a conta atrás pública).",
    en: "When the hackathon clock starts (the public countdown).",
  },
  hackingEndsLabel: { es: "Termina el hacking", gl: "Remata o hacking", en: "Hacking ends" },
  mustBeAfterStartTime: {
    es: "Debe ser posterior a la hora de inicio.",
    gl: "Debe ser posterior á hora de inicio.",
    en: "Must be after the start time.",
  },
  countdownToStartLabel: {
    es: "Cuenta atrás hasta el inicio",
    gl: "Conta atrás ata o inicio",
    en: "Countdown to start",
  },
  countdownDesc: {
    es: "Antes de que empiece el hackathon, muestra una cuenta atrás en directo hasta la hora de inicio en lugar de una duración fija.",
    gl: "Antes de que comece o hackathon, amosa unha conta atrás en directo ata a hora de inicio no canto dunha duración fixa.",
    en: "Before hacking starts, show a live countdown to the start time instead of a locked duration.",
  },
  venueSectionTitle: {
    es: "Sede",
    gl: "Sede",
    en: "Venue",
  },
  venueSectionDesc: {
    es: "Dónde se celebra el evento. El nombre y las coordenadas también se usan en el pase de Apple Wallet (aviso en la pantalla de bloqueo al llegar a la sede).",
    gl: "Onde se celebra o evento. O nome e as coordenadas tamén se usan no pase de Apple Wallet (aviso na pantalla de bloqueo ao chegar á sede).",
    en: "Where the event takes place. The name and coordinates also feed the Apple Wallet pass (lock-screen prompt when arriving at the venue).",
  },
  venueNameLabel: {
    es: "Nombre de la sede",
    gl: "Nome da sede",
    en: "Venue name",
  },
  venueLatitudeLabel: { es: "Latitud", gl: "Latitude", en: "Latitude" },
  venueLongitudeLabel: { es: "Longitud", gl: "Lonxitude", en: "Longitude" },
  coordsFormatsHint: {
    es: "Acepta grados decimales (43.3328) o GMS (43°19′58″N). Pega las dos coordenadas juntas en cualquiera de los campos y se repartirán solas.",
    gl: "Acepta graos decimais (43.3328) ou GMS (43°19′58″N). Pega as dúas coordenadas xuntas en calquera dos campos e repartiranse soas.",
    en: "Accepts decimal degrees (43.3328) or DMS (43°19′58″N). Paste both coordinates together into either box and they'll split automatically.",
  },
  invalidCoordinate: {
    es: "Coordenada no válida. Usa grados decimales (43.3328) o GMS (43°19′58″N).",
    gl: "Coordenada non válida. Usa graos decimais (43.3328) ou GMS (43°19′58″N).",
    en: "Invalid coordinate. Use decimal degrees (43.3328) or DMS (43°19′58″N).",
  },
  venueCoordsBothOrNeither: {
    es: "La latitud y la longitud deben indicarse juntas.",
    gl: "A latitude e a lonxitude deben indicarse xuntas.",
    en: "Latitude and longitude must be set together.",
  },
  walletPassSectionTitle: {
    es: "Pase de Apple Wallet",
    gl: "Pase de Apple Wallet",
    en: "Apple Wallet pass",
  },
  walletPassSectionDesc: {
    es: "Qué muestra el pase. Los campos se rellenan solos con los datos de cada asistente y del evento — aquí eliges cuáles se muestran y con qué etiqueta.",
    gl: "Que amosa o pase. Os campos énchense sós cos datos de cada asistente e do evento — aquí escolles cales se amosan e con que etiqueta.",
    en: "What the pass shows. Fields fill themselves from each attendee's and the event's data — here you choose which appear and with what caption.",
  },
  passFrontFieldsLabel: {
    es: "Anverso del pase",
    gl: "Anverso do pase",
    en: "Front of the pass",
  },
  passFrontFieldsDesc: {
    es: "Activa o desactiva cada campo y personaliza su etiqueta si quieres.",
    gl: "Activa ou desactiva cada campo e personaliza a súa etiqueta se queres.",
    en: "Toggle each field on or off and customize its caption if you like.",
  },
  passFieldParticipantTitle: {
    es: "Nombre del asistente",
    gl: "Nome do asistente",
    en: "Attendee name",
  },
  passFieldRoleTitle: { es: "Rol", gl: "Rol", en: "Role" },
  passFieldPassTypeTitle: { es: "Tipo de pase", gl: "Tipo de pase", en: "Pass type" },
  passFieldUniversityTitle: { es: "Universidad", gl: "Universidade", en: "University" },
  passFieldEmailTitle: { es: "Email", gl: "Email", en: "Email" },
  captionOnPassLabel: {
    es: "Etiqueta en el pase",
    gl: "Etiqueta no pase",
    en: "Caption on the pass",
  },
  passFillParticipant: {
    es: "Se rellena con el nombre y apellidos del asistente.",
    gl: "Énchese co nome e apelidos do asistente.",
    en: "Filled with the attendee's full name.",
  },
  passFillRole: {
    es: "Se rellena con el rol del asistente (Participant, Staff, Judge…).",
    gl: "Énchese co rol do asistente (Participant, Staff, Judge…).",
    en: "Filled with the attendee's role (Participant, Staff, Judge…).",
  },
  passFillPassType: {
    es: "Se rellena según el tipo de pase de cada asistente, con los textos de abajo.",
    gl: "Énchese segundo o tipo de pase de cada asistente, cos textos de abaixo.",
    en: "Filled per attendee's pass kind, using the texts below.",
  },
  passFillUniversity: {
    es: "Se rellena con la universidad del asistente (se oculta si no tiene).",
    gl: "Énchese coa universidade do asistente (ocúltase se non ten).",
    en: "Filled with the attendee's university (hidden when they have none).",
  },
  passFillEmail: {
    es: "Se rellena con el email del asistente.",
    gl: "Énchese co email do asistente.",
    en: "Filled with the attendee's email.",
  },
  passTicketValueText: {
    es: "Texto para pases de entrada",
    gl: "Texto para pases de entrada",
    en: "Text for ticket passes",
  },
  passBadgeValueText: {
    es: "Texto para pases de acreditación",
    gl: "Texto para pases de acreditación",
    en: "Text for badge passes",
  },
  passBackBuiltinLabel: {
    es: "Reverso del pase",
    gl: "Reverso do pase",
    en: "Back of the pass",
  },
  passBackBuiltinDesc: {
    es: "Estos campos aparecen al dar la vuelta al pase, ya rellenos con la información del evento.",
    gl: "Estes campos aparecen ao voltear o pase, xa enchidos coa información do evento.",
    en: "These fields appear when flipping the pass over, already filled with the event's info.",
  },
  passFillEventName: {
    es: "Nombre del evento (arriba)",
    gl: "Nome do evento (arriba)",
    en: "The event name (above)",
  },
  passFillVenueName: {
    es: "Nombre de la sede (arriba)",
    gl: "Nome da sede (arriba)",
    en: "The venue name (above)",
  },
  passFillOrganizer: {
    es: "Fijado en el despliegue",
    gl: "Fixado no despregue",
    en: "Set at deploy time",
  },
  notSetYet: { es: "sin definir", gl: "sen definir", en: "not set" },
  passBackFieldsLabel: {
    es: "Campos adicionales del reverso",
    gl: "Campos adicionais do reverso",
    en: "Extra back fields",
  },
  passBackFieldsDesc: {
    es: "Pares etiqueta/valor que se añaden al reverso del pase (horario, normas, enlaces...).",
    gl: "Pares etiqueta/valor que se engaden ao reverso do pase (horario, normas, ligazóns...).",
    en: "Label/value pairs added to the back of the pass (schedule, rules, links…).",
  },
  backFieldLabelPlaceholder: { es: "Etiqueta", gl: "Etiqueta", en: "Label" },
  backFieldValuePlaceholder: { es: "Valor", gl: "Valor", en: "Value" },
  addBackField: { es: "Añadir campo", gl: "Engadir campo", en: "Add field" },
  removeBackFieldAria: {
    es: "Eliminar campo {index}",
    gl: "Eliminar campo {index}",
    en: "Remove field {index}",
  },
  couldNotLoadJudgingWindow: {
    es: "No se ha podido cargar la ventana de evaluación.",
    gl: "Non se puido cargar a ventá de avaliación.",
    en: "Could not load the judging window.",
  },
  judgingWindowSaved: {
    es: "Ventana de evaluación guardada.",
    gl: "Ventá de avaliación gardada.",
    en: "Judging window saved.",
  },
  couldNotSaveJudgingWindow: {
    es: "No se ha podido guardar la ventana de evaluación.",
    gl: "Non se puido gardar a ventá de avaliación.",
    en: "Could not save the judging window.",
  },
  judgingWindowTitle: {
    es: "Ventana de evaluación",
    gl: "Ventá de avaliación",
    en: "Judging window",
  },
  judgingWindowDesc: {
    es: "Determina cuánto tiempo tienen las salas de evaluación por proyecto — el ritmo de sala se ajusta automáticamente a medida que se acerca el final de esta ventana.",
    gl: "Determina canto tempo teñen as salas de avaliación por proxecto — o ritmo de sala axústase automaticamente a medida que se achega o final desta ventá.",
    en: "Sizes how much time judging rooms have per project — room pacing tightens automatically as this window's end approaches.",
  },
  judgingStartsLabel: {
    es: "Empieza la evaluación",
    gl: "Comeza a avaliación",
    en: "Judging starts",
  },
  judgingEndsLabel: { es: "Termina la evaluación", gl: "Remata a avaliación", en: "Judging ends" },

  // ---- Admin: libraries (universities, intolerances) ----
  librariesDesc: {
    es: "Listas de referencia compartidas usadas en el registro, los perfiles y los formularios de solicitud.",
    gl: "Listas de referencia compartidas usadas no rexistro, os perfís e os formularios de solicitude.",
    en: "Shared reference lists used across registration, profiles and application forms.",
  },
  universitiesTab: { es: "Universidades", gl: "Universidades", en: "Universities" },
  couldNotLoadDictionary: {
    es: "No se ha podido cargar el catálogo.",
    gl: "Non se puido cargar o catálogo.",
    en: "Could not load the dictionary.",
  },
  intoleranceUpdated: {
    es: "Intolerancia actualizada.",
    gl: "Intolerancia actualizada.",
    en: "Intolerance updated.",
  },
  intoleranceAdded: {
    es: "Intolerancia añadida.",
    gl: "Intolerancia engadida.",
    en: "Intolerance added.",
  },
  couldNotSaveEntry: {
    es: "No se ha podido guardar la entrada.",
    gl: "Non se puido gardar a entrada.",
    en: "Could not save the entry.",
  },
  intoleranceDeleted: {
    es: "Intolerancia eliminada.",
    gl: "Intolerancia eliminada.",
    en: "Intolerance deleted.",
  },
  couldNotDeleteEntry: {
    es: "No se ha podido eliminar la entrada.",
    gl: "Non se puido eliminar a entrada.",
    en: "Could not delete the entry.",
  },
  sharedCatalogueDesc: {
    es: "El catálogo compartido y traducible usado por los selectores de registro y perfil, y por el campo dietético de las solicitudes.",
    gl: "O catálogo compartido e traducible usado polos selectores de rexistro e perfil, e polo campo dietético das solicitudes.",
    en: "The shared, translatable catalogue used by the registration and profile pickers and the application dietary field.",
  },
  newAction: { es: "Nuevo", gl: "Novo", en: "New" },
  noIntolerancesYetTitle: {
    es: "Aún no hay intolerancias",
    gl: "Aínda non hai intolerancias",
    en: "No intolerances yet",
  },
  addFirstEntryDietaryDesc: {
    es: "Añade la primera entrada para que los participantes puedan seleccionarla durante el registro.",
    gl: "Engade a primeira entrada para que os participantes poidan seleccionala durante o rexistro.",
    en: "Add the first entry so participants can pick it during registration.",
  },
  openMenuAria: { es: "Abrir menú", gl: "Abrir menú", en: "Open menu" },
  editIntoleranceTitle: {
    es: "Editar intolerancia",
    gl: "Editar intolerancia",
    en: "Edit intolerance",
  },
  newIntoleranceTitle: { es: "Nueva intolerancia", gl: "Nova intolerancia", en: "New intolerance" },
  provideLabelEveryLocaleDesc: {
    es: "Aporta la etiqueta en todos los idiomas. La descripción es opcional pero todo o nada.",
    gl: "Achega a etiqueta en todos os idiomas. A descrición é opcional pero todo ou nada.",
    en: "Provide the label in every locale. The description is optional but all-or-nothing.",
  },
  addIntolerance: { es: "Añadir intolerancia", gl: "Engadir intolerancia", en: "Add intolerance" },
  descriptionOptionalLabel: {
    es: "Descripción (opcional)",
    gl: "Descrición (opcional)",
    en: "Description (optional)",
  },
  deleteIntoleranceTitle: {
    es: "Eliminar intolerancia",
    gl: "Eliminar intolerancia",
    en: "Delete intolerance",
  },
  removeFromDictionaryInline: {
    es: "¿Quitar «{label}» del catálogo? Las selecciones existentes de los participantes conservan su id pero dejan de resolverse.",
    gl: "Quitar «{label}» do catálogo? As seleccións existentes dos participantes conservan o seu id pero deixan de resolverse.",
    en: 'Remove "{label}" from the dictionary? Existing participant selections keep their id but stop resolving.',
  },
  confirmDeletionAria: {
    es: "Confirmar eliminación",
    gl: "Confirmar eliminación",
    en: "Confirm deletion",
  },
  fillEveryLocaleOrBlank: {
    es: "Rellena todos los idiomas o deja la descripción en blanco",
    gl: "Cobre todos os idiomas ou deixa a descrición en branco",
    en: "Fill every locale or leave the description blank",
  },
  couldNotLoadDirectory: {
    es: "No se ha podido cargar el directorio.",
    gl: "Non se puido cargar o directorio.",
    en: "Could not load the directory.",
  },
  universityRenamed: {
    es: "Universidad renombrada.",
    gl: "Universidade renomeada.",
    en: "University renamed.",
  },
  universityAdded: {
    es: "Universidad añadida.",
    gl: "Universidade engadida.",
    en: "University added.",
  },
  couldNotSaveUniversity: {
    es: "No se ha podido guardar la universidad.",
    gl: "Non se puido gardar a universidade.",
    en: "Could not save the university.",
  },
  universityDeleted: {
    es: "Universidad eliminada.",
    gl: "Universidade eliminada.",
    en: "University deleted.",
  },
  couldNotDeleteUniversity: {
    es: "No se ha podido eliminar la universidad.",
    gl: "Non se puido eliminar a universidade.",
    en: "Could not delete the university.",
  },
  sharedDirectoryDesc: {
    es: "El directorio compartido que alimenta el selector de universidades en los formularios de solicitud. Los solicitantes pueden proponer nuevas; tú las gestionas aquí.",
    gl: "O directorio compartido que alimenta o selector de universidades nos formularios de solicitude. Os solicitantes poden propoñer novas; ti xestiónaas aquí.",
    en: "The shared directory backing the university picker on application forms. Applicants can propose new ones; you curate them here.",
  },
  searchUniversitiesPlaceholder: {
    es: "Buscar universidades…",
    gl: "Buscar universidades…",
    en: "Search universities…",
  },
  noMatchesTitle: { es: "Sin coincidencias", gl: "Sen coincidencias", en: "No matches" },
  noUniversitiesYetTitle: {
    es: "Aún no hay universidades",
    gl: "Aínda non hai universidades",
    en: "No universities yet",
  },
  noUniversityMatchDesc: {
    es: "Ninguna universidad coincide con esta búsqueda. Añádela abajo.",
    gl: "Ningunha universidade coincide con esta busca. Engádea abaixo.",
    en: "No university matches this search. Add it below.",
  },
  addFirstOrProposeDesc: {
    es: "Añade la primera entrada, o deja que los solicitantes propongan otras desde el formulario.",
    gl: "Engade a primeira entrada, ou deixa que os solicitantes propoñan outras desde o formulario.",
    en: "Add the first entry, or let applicants propose ones from the form.",
  },
  rename: { es: "Renombrar", gl: "Renomear", en: "Rename" },
  renameUniversityTitle: {
    es: "Renombrar universidad",
    gl: "Renomear universidade",
    en: "Rename university",
  },
  newUniversityTitle: { es: "Nueva universidad", gl: "Nova universidade", en: "New university" },
  updateInstitutionNameDesc: {
    es: "Actualiza el nombre de la institución. Las selecciones de los solicitantes conservan su id.",
    gl: "Actualiza o nome da institución. As seleccións dos solicitantes conservan o seu id.",
    en: "Update the institution's name. Applicant selections keep their id.",
  },
  addInstitutionDesc: {
    es: "Añade una institución al directorio compartido.",
    gl: "Engade unha institución ao directorio compartido.",
    en: "Add an institution to the shared directory.",
  },
  addUniversity: { es: "Añadir universidad", gl: "Engadir universidade", en: "Add university" },
  removeFromDirectoryInline: {
    es: "¿Quitar «{name}» del directorio? Las selecciones existentes de los solicitantes conservan su id pero dejan de resolverse.",
    gl: "Quitar «{name}» do directorio? As seleccións existentes dos solicitantes conservan o seu id pero deixan de resolverse.",
    en: 'Remove "{name}" from the directory? Existing applicant selections keep their id but stop resolving.',
  },

  // ---- Admin: delete university dialog ----
  deleteUniversityTitle: {
    es: "Eliminar universidad",
    gl: "Eliminar universidade",
    en: "Delete university",
  },

  // ---- Admin: university search/select ----
  addedUniversityInline: {
    es: "Añadido «{name}».",
    gl: "Engadido «{name}».",
    en: 'Added "{name}".',
  },
  couldNotAddUniversity: {
    es: "No se ha podido añadir esa universidad.",
    gl: "Non se puido engadir esa universidade.",
    en: "Could not add that university.",
  },
  searchUniversitiesShortPlaceholder: {
    es: "Buscar universidades…",
    gl: "Buscar universidades…",
    en: "Search universities…",
  },
  typeToSearchUniversities: {
    es: "Escribe para buscar universidades.",
    gl: "Escribe para buscar universidades.",
    en: "Type to search universities.",
  },
  addQuotedInline: { es: "Añadir «{query}»", gl: "Engadir «{query}»", en: 'Add "{query}"' },
  selectYourUniversityPlaceholder: {
    es: "Selecciona tu universidad…",
    gl: "Selecciona a túa universidade…",
    en: "Select your university…",
  },
  universityNumberFallback: {
    es: "Universidad #{id}",
    gl: "Universidade #{id}",
    en: "University #{id}",
  },
  selectPlaceholder: { es: "Selecciona…", gl: "Selecciona…", en: "Select…" },
  noFileUploadedPeriod: {
    es: "Ningún archivo subido.",
    gl: "Ningún ficheiro subido.",
    en: "No file uploaded.",
  },
  minLabel: { es: "min", gl: "min", en: "min" },
  secLabel: { es: "seg", gl: "seg", en: "sec" },
  presentationSecondsAria: {
    es: "Segundos de presentación",
    gl: "Segundos de presentación",
    en: "Presentation seconds",
  },

  // ---- Staff: logistics stats detail ----
  servingsLabel: { es: "Raciones", gl: "Racións", en: "Servings" },
  selectToSeeCounts: {
    es: "Selecciona para ver los recuentos",
    gl: "Selecciona para ver os recontos",
    en: "Select to see counts",
  },
  distinctAttendees: {
    es: "Asistentes distintos",
    gl: "Asistentes distintos",
    en: "Distinct attendees",
  },
  mealLineTitle: { es: "Línea de comida", gl: "Liña de comida", en: "Meal line" },
  activityDoorTitle: { es: "Puerta de actividad", gl: "Porta de actividade", en: "Activity door" },
  scanEachBadgeDesc: {
    es: "Escanea cada acreditación a su paso. Las repeticiones necesitan confirmación explícita.",
    gl: "Escanea cada acreditación ao seu paso. As repeticións precisan confirmación explícita.",
    en: "Scan each badge as it passes. Repeats need explicit confirmation.",
  },
  scanBadgesEntranceDesc: {
    es: "Escanea acreditaciones en la entrada de una actividad registrable.",
    gl: "Escanea acreditacións na entrada dunha actividade rexistrable.",
    en: "Scan badges at the entrance of a registrable activity.",
  },
  noMealsDefinedTitle: {
    es: "Aún no hay comidas definidas",
    gl: "Aínda non hai comidas definidas",
    en: "No meals defined yet",
  },
  noRegistrableActivitiesTitle: {
    es: "Aún no hay actividades registrables",
    gl: "Aínda non hai actividades rexistrables",
    en: "No registrable activities yet",
  },
  mealsCreatedInScheduleDesc: {
    es: "Las comidas se crean en la gestión del programa.",
    gl: "As comidas créanse na xestión do programa.",
    en: "Meals are created in schedule management.",
  },
  markActivitiesRequiresScanDesc: {
    es: "Marca las actividades como registrables en la gestión del programa.",
    gl: "Marca as actividades como rexistrables na xestión do programa.",
    en: "Mark activities as requires-scan in schedule management.",
  },
  chooseMeal: { es: "Elige una comida", gl: "Elixe unha comida", en: "Choose meal" },
  chooseActivityOption: {
    es: "Elige una actividad",
    gl: "Elixe unha actividade",
    en: "Choose activity",
  },
  repeatOn: { es: "Repetición activada", gl: "Repetición activada", en: "Repeat on" },
  noRepeat: { es: "Sin repetición", gl: "Sen repetición", en: "No repeat" },
  scan: { es: "Escanear", gl: "Escanear", en: "Scan" },
  scanRegistered: { es: "Escaneo registrado.", gl: "Escaneo rexistrado.", en: "Scan registered." },
  repeatRegistered: {
    es: "Repetición registrada.",
    gl: "Repetición rexistrada.",
    en: "Repeat registered.",
  },
  scanFailed: { es: "El escaneo ha fallado.", gl: "O escaneo fallou.", en: "Scan failed." },
  scanQueuedLocally: {
    es: "Escaneo guardado localmente.",
    gl: "Escaneo gardado localmente.",
    en: "Scan queued locally.",
  },
  offlineSyncFailed: {
    es: "La sincronización sin conexión ha fallado.",
    gl: "A sincronización sen conexión fallou.",
    en: "Offline sync failed.",
  },
  queueLocally: { es: "Guardar localmente", gl: "Gardar localmente", en: "Queue locally" },
  syncPending: {
    es: "Sincronizar {count} pendientes",
    gl: "Sincronizar {count} pendentes",
    en: "Sync {count} pending",
  },
  clearLocalQueue: { es: "Vaciar cola local", gl: "Baleirar cola local", en: "Clear local queue" },
  localQueueTitle: { es: "Cola local", gl: "Cola local", en: "Local queue" },
  intoleranceFallback: { es: "Intolerancia", gl: "Intolerancia", en: "Intolerance" },
  notConfirmedBadge: { es: "Sin confirmar", gl: "Sen confirmar", en: "Not confirmed" },
  badgeCapitalInline: {
    es: "Acreditación {badge}",
    gl: "Acreditación {badge}",
    en: "Badge {badge}",
  },
  noBadge: { es: "Sin acreditación", gl: "Sen acreditación", en: "No badge" },
  currentlyInside: { es: "Actualmente dentro", gl: "Actualmente dentro", en: "Currently inside" },
  currentlyOutside: { es: "Actualmente fuera", gl: "Actualmente fóra", en: "Currently outside" },
  foodLabel: { es: "Comida", gl: "Comida", en: "Food" },
  noRestrictions: { es: "Sin restricciones", gl: "Sen restricións", en: "No restrictions" },
  noNotes: { es: "Sin notas", gl: "Sen notas", en: "No notes" },

  // ---- Queue status labels ----
  queueStatusWaiting: { es: "En cola", gl: "En cola", en: "In queue" },
  queueStatusCalled: { es: "Llamado", gl: "Chamado", en: "Called" },
  queueStatusInRoom: { es: "En la sala", gl: "Na sala", en: "In room" },
  queueStatusPresenting: { es: "Presentando", gl: "Presentando", en: "Presenting" },
  queueStatusCompleted: { es: "Evaluado", gl: "Avaliado", en: "Evaluated" },
  queueStatusDisqualified: { es: "Descalificado", gl: "Descualificado", en: "Disqualified" },

  // ---- Admin: audit log ----
  noAccessAuditLog: {
    es: "No puedes ver el registro de auditoría",
    gl: "Non podes ver o rexistro de auditoría",
    en: "You can't view the audit log",
  },
  auditLogAccessDeniedDesc: {
    es: "El registro de auditoría requiere el permiso audit:read.",
    gl: "O rexistro de auditoría require o permiso audit:read.",
    en: "The audit log requires the audit:read capability.",
  },
  userInline: { es: "usuario #{id}", gl: "usuario #{id}", en: "user #{id}" },
  colActor: { es: "Actor", gl: "Actor", en: "Actor" },
  systemActor: { es: "sistema", gl: "sistema", en: "system" },
  auditLogPageDesc: {
    es: "Acciones sensibles en toda hackOS: quién, qué, cuándo y desde dónde.",
    gl: "Accións sensibles en toda hackOS: quen, que, cando e desde onde.",
    en: "Sensitive actions across hackOS: who, what, when and from where.",
  },
  entityTypeLabel: { es: "Tipo de entidad", gl: "Tipo de entidade", en: "Entity type" },
  entityIdLabel: { es: "ID de entidad", gl: "ID de entidade", en: "Entity ID" },
  actorUserIdLabel: { es: "ID de usuario autor", gl: "ID de usuario autor", en: "Actor user ID" },
  fromLabel: { es: "Desde", gl: "Desde", en: "From" },
  toLabel: { es: "Hasta", gl: "Ata", en: "To" },
  clearFilters: { es: "Borrar filtros", gl: "Borrar filtros", en: "Clear filters" },
  noAuditEntriesTitle: {
    es: "Sin entradas de auditoría",
    gl: "Sen entradas de auditoría",
    en: "No audit entries",
  },
  noEntriesMatchFilters: {
    es: "Ninguna entrada coincide con estos filtros.",
    gl: "Ningunha entrada coincide con estes filtros.",
    en: "No entries match these filters.",
  },
  sensitiveActionsAppearDesc: {
    es: "Las acciones sensibles aparecerán aquí a medida que ocurran.",
    gl: "As accións sensibles aparecerán aquí a medida que ocorran.",
    en: "Sensitive actions will appear here as they happen.",
  },
  ipLabel: { es: "IP", gl: "IP", en: "IP" },
  userAgentLabel: { es: "Agente de usuario", gl: "Axente de usuario", en: "User agent" },
  beforeLabel: { es: "Antes", gl: "Antes", en: "Before" },
  afterLabel: { es: "Después", gl: "Despois", en: "After" },

  // ---- Shared UI primitives ----
  accept: { es: "Aceptar", gl: "Aceptar", en: "Accept" },
  acceptedLabel: { es: "Aceptada", gl: "Aceptada", en: "Accepted" },
  acceptedUnsentStatus: {
    es: "aceptada (sin enviar)",
    gl: "aceptada (sen enviar)",
    en: "accepted (unsent)",
  },
  acceptedUnsentToast: {
    es: "Aceptada (sin enviar).",
    gl: "Aceptada (sen enviar).",
    en: "Accepted (unsent).",
  },
  actionFailed: { es: "La acción ha fallado.", gl: "A acción fallou.", en: "Action failed." },
  activeLabel: { es: "Activo", gl: "Activo", en: "Active" },
  addAtLeastOneOptionDesc: {
    es: "Añade al menos una opción para una pregunta de elección.",
    gl: "Engade polo menos unha opción para unha pregunta de elección.",
    en: "Add at least one option for a choice question.",
  },
  addOption: { es: "Añadir opción", gl: "Engadir opción", en: "Add option" },
  addQuestion: { es: "Añadir pregunta", gl: "Engadir pregunta", en: "Add question" },
  allowedFileTypesDesc: {
    es: "Extensiones separadas por comas. Vacío = pdf/doc/imágenes.",
    gl: "Extensións separadas por comas. Baleiro = pdf/doc/imaxes.",
    en: "Comma-separated extensions. Blank = pdf/doc/images.",
  },
  allowedFileTypesLabel: {
    es: "Tipos de archivo permitidos",
    gl: "Tipos de ficheiro permitidos",
    en: "Allowed file types",
  },
  allStatuses: { es: "Todos los estados", gl: "Todos os estados", en: "All statuses" },
  answersLabel: { es: "Respuestas", gl: "Respostas", en: "Answers" },
  answersUpdated: {
    es: "Respuestas actualizadas.",
    gl: "Respostas actualizadas.",
    en: "Answers updated.",
  },
  applicantColumn: { es: "Solicitante", gl: "Solicitante", en: "Applicant" },
  applicantsAnswerPlaceholder: {
    es: "Respuesta del solicitante",
    gl: "Resposta do solicitante",
    en: "Applicant's answer",
  },
  applicationNumber: { es: "Solicitud #{id}", gl: "Solicitude #{id}", en: "Application #{id}" },
  backToApplications: {
    es: "Volver a solicitudes",
    gl: "Volver a solicitudes",
    en: "Back to applications",
  },
  backToReview: { es: "Volver a revisión", gl: "Volver a revisión", en: "Back to review" },
  batchActionFailed: {
    es: "La acción en bloque ha fallado.",
    gl: "A acción en bloque fallou.",
    en: "Batch action failed.",
  },
  batchSkipped: {
    es: "{label} {count} omitidas ({reason}).",
    gl: "{label} {count} omitidas ({reason}).",
    en: "{label} {count} skipped ({reason}).",
  },
  blankMax10MbDesc: { es: "Vacío = 10 MB.", gl: "Baleiro = 10 MB.", en: "Blank = 10 MB." },
  confirmOverride: { es: "Confirmar (anular)", gl: "Confirmar (anular)", en: "Confirm (override)" },
  couldNotLoadForm: {
    es: "No se ha podido cargar este formulario.",
    gl: "Non se puido cargar este formulario.",
    en: "Could not load this form.",
  },
  couldNotLoadResponses: {
    es: "No se han podido cargar las respuestas.",
    gl: "Non se puideron cargar as respostas.",
    en: "Could not load responses.",
  },
  couldNotSaveAnswers: {
    es: "No se han podido guardar las respuestas.",
    gl: "Non se puideron gardar as respostas.",
    en: "Could not save the answers.",
  },
  couldNotSaveNotes: {
    es: "No se han podido guardar las notas.",
    gl: "Non se puideron gardar as notas.",
    en: "Could not save notes.",
  },
  couldNotSendDecisions: {
    es: "No se han podido enviar las decisiones.",
    gl: "Non se puideron enviar as decisións.",
    en: "Could not send decisions.",
  },
  decide: { es: "Decidir", gl: "Decidir", en: "Decide" },
  decisionLabel: { es: "Decisión", gl: "Decisión", en: "Decision" },
  decisionResent: { es: "Decisión reenviada.", gl: "Decisión reenviada.", en: "Decision resent." },
  decisionsApplied: {
    es: "Decisiones aplicadas.",
    gl: "Decisións aplicadas.",
    en: "Decisions applied.",
  },
  decisionSent: { es: "Decisión enviada.", gl: "Decisión enviada.", en: "Decision sent." },
  decisionsSent: { es: "Decisiones enviadas.", gl: "Decisións enviadas.", en: "Decisions sent." },
  declinedHint: {
    es: "{unsent} sin enviar · {sent} enviadas · {declined} rechazadas · {expired} caducadas",
    gl: "{unsent} sen enviar · {sent} enviadas · {declined} rexeitadas · {expired} caducadas",
    en: "{unsent} unsent · {sent} sent · {declined} declined · {expired} expired",
  },
  declineOverride: { es: "Rechazar (anular)", gl: "Rexeitar (anular)", en: "Decline (override)" },
  dietaryInfo: { es: "Información dietética", gl: "Información dietética", en: "Dietary info" },
  dietaryNotes: { es: "Notas dietéticas", gl: "Notas dietéticas", en: "Dietary notes" },
  dietaryRestrictions: {
    es: "Restricciones dietéticas",
    gl: "Restricións dietéticas",
    en: "Dietary restrictions",
  },
  duplicateKey: {
    es: 'Clave duplicada "{key}".',
    gl: 'Clave duplicada "{key}".',
    en: 'Duplicate key "{key}".',
  },
  duplicateOption: {
    es: '"{key}" tiene una opción duplicada "{value}".',
    gl: '"{key}" ten unha opción duplicada "{value}".',
    en: '"{key}" has duplicate option "{value}".',
  },
  editAnswers: { es: "Editar respuestas", gl: "Editar respostas", en: "Edit answers" },
  everyQuestionNeedsKey: {
    es: "Toda pregunta necesita una clave.",
    gl: "Toda pregunta precisa unha clave.",
    en: "Every question needs a key.",
  },
  fieldKindCheckbox: { es: "Casilla", gl: "Caixa de verificación", en: "Checkbox" },
  fieldKindDate: { es: "Fecha", gl: "Data", en: "Date" },
  fieldKindFile: { es: "Subida de archivo", gl: "Subida de ficheiro", en: "File upload" },
  fieldKindFileUrl: { es: "URL de archivo", gl: "URL de ficheiro", en: "File URL" },
  fieldKindMultiselect: { es: "Opción múltiple", gl: "Opción múltiple", en: "Multiple choice" },
  fieldKindNumber: { es: "Número", gl: "Número", en: "Number" },
  fieldKindSelect: { es: "Opción única", gl: "Opción única", en: "Single choice" },
  fieldKindText: { es: "Texto corto", gl: "Texto curto", en: "Short text" },
  fieldKindTextarea: { es: "Texto largo", gl: "Texto longo", en: "Long text" },
  fieldKindUniversity: { es: "Universidad", gl: "Universidade", en: "University" },
  fieldLabelLabel: { es: "Etiqueta", gl: "Etiqueta", en: "Label" },
  fieldKeyLabel: { es: "Clave", gl: "Clave", en: "Key" },
  fileUploadPlaceholder: { es: "Subida de archivo", gl: "Subida de ficheiro", en: "File upload" },
  formCouldNotBeLoaded: {
    es: "No se ha podido cargar este formulario de solicitud.",
    gl: "Non se puido cargar este formulario de solicitude.",
    en: "This application form could not be loaded.",
  },
  formNotFound: {
    es: "Formulario no encontrado",
    gl: "Formulario non atopado",
    en: "Form not found",
  },
  formTabLabel: { es: "Formulario", gl: "Formulario", en: "Form" },
  inactiveFormsDesc: {
    es: "Los formularios inactivos no admiten nuevas solicitudes.",
    gl: "Os formularios inactivos non admiten novas solicitudes.",
    en: "Inactive forms are closed to new applicants.",
  },
  includeRejectionsDesc: {
    es: "También envía correo a los solicitantes rechazados. Desactivado = solo aceptados.",
    gl: "Tamén envía correo aos solicitantes rexeitados. Desactivado = só aceptados.",
    en: "Also email applicants who were rejected. Off = accepted only.",
  },
  includeRejectionsLabel: {
    es: "Incluir rechazos",
    gl: "Incluír rexeitamentos",
    en: "Include rejections",
  },
  keyMustBeAlphanumeric: {
    es: 'La clave "{key}" debe ser alfanumérica/._-',
    gl: 'A clave "{key}" debe ser alfanumérica/._-',
    en: 'Key "{key}" must be alphanumeric/._-',
  },
  kindLabel: { es: "Tipo", gl: "Tipo", en: "Kind" },
  linkPlaceholder: { es: "https://… (enlace)", gl: "https://… (ligazón)", en: "https://… (link)" },
  maxSizeMbLabel: { es: "Tamaño máximo (MB)", gl: "Tamaño máximo (MB)", en: "Max size (MB)" },
  metadataUnavailable: {
    es: "Metadatos no disponibles",
    gl: "Metadatos non dispoñibles",
    en: "Metadata unavailable",
  },
  metadataUnavailableDesc: {
    es: "La ventana del formulario está cerrada, así que su definición no se puede leer aquí.",
    gl: "A ventá do formulario está pechada, así que a súa definición non se pode ler aquí.",
    en: "The form window is closed, so its definition isn't readable here.",
  },
  more: { es: "Más", gl: "Máis", en: "More" },
  movedBackToReview: {
    es: "Movida de nuevo a revisión.",
    gl: "Movida de novo a revisión.",
    en: "Moved back to review.",
  },
  moveDown: { es: "Mover abajo", gl: "Mover abaixo", en: "Move down" },
  moveUp: { es: "Mover arriba", gl: "Mover arriba", en: "Move up" },
  needDecideCapability: {
    es: "Necesitas el permiso applications:decide para aceptar o rechazar.",
    gl: "Precisas o permiso applications:decide para aceptar ou rexeitar.",
    en: "You need applications:decide to accept or reject.",
  },
  needsAtLeastOneOption: {
    es: '"{key}" necesita al menos una opción.',
    gl: '"{key}" precisa polo menos unha opción.',
    en: '"{key}" needs at least one option.',
  },
  noAnswersRecorded: {
    es: "No hay respuestas registradas.",
    gl: "Non hai respostas rexistradas.",
    en: "No answers recorded.",
  },
  noLabel: { es: "No", gl: "Non", en: "No" },
  nonDraftHint: { es: "No borrador", gl: "Non borrador", en: "Non-draft" },
  noOptionsDefined: {
    es: "Sin opciones definidas",
    gl: "Sen opcións definidas",
    en: "No options defined",
  },
  noQuestionsYet: {
    es: "Aún no hay preguntas",
    gl: "Aínda non hai preguntas",
    en: "No questions yet",
  },
  noQuestionsYetDesc: {
    es: "Añade campos que responderán los solicitantes. El nombre, correo y logística se recogen aparte.",
    gl: "Engade campos que responderán os solicitantes. O nome, correo e loxística recóllense á parte.",
    en: "Add fields applicants will answer. Name, email and logistics are collected separately.",
  },
  noResponsesMatchFilterDesc: {
    es: "Ninguna respuesta coincide con este filtro.",
    gl: "Ningunha resposta coincide con este filtro.",
    en: "No responses match this filter.",
  },
  noResponsesTitle: { es: "Sin respuestas", gl: "Sen respostas", en: "No responses" },
  nothingLeftToSend: {
    es: "No queda nada por enviar.",
    gl: "Non queda nada por enviar.",
    en: "Nothing left to send.",
  },
  optionsLabel: { es: "Opciones", gl: "Opcións", en: "Options" },
  optionWithNoValue: {
    es: '"{key}" tiene una opción sin valor.',
    gl: '"{key}" ten unha opción sen valor.',
    en: '"{key}" has an option with no value.',
  },
  preview: { es: "Vista previa", gl: "Vista previa", en: "Preview" },
  previewIntro: {
    es: "Así es como los solicitantes ven el formulario (se muestran las etiquetas en español). El nombre, correo y logística se recogen aparte.",
    gl: "Así é como os solicitantes ven o formulario (móstranse as etiquetas en castelán). O nome, correo e loxística recóllense á parte.",
    en: "This is how applicants see the form (Spanish labels shown). Name, email and logistics are collected separately.",
  },
  previewTitle: {
    es: "Vista previa — {name}",
    gl: "Vista previa — {name}",
    en: "Preview — {name}",
  },
  quotaInline: { es: "cupo {capacity}", gl: "cota {capacity}", en: "quota {capacity}" },
  reaccept: { es: "Volver a aceptar", gl: "Volver a aceptar", en: "Re-accept" },
  reacceptDeclinedExpired: {
    es: "Volver a aceptar (rechazada/caducada)",
    gl: "Volver a aceptar (rexeitada/caducada)",
    en: "Re-accept (declined/expired)",
  },
  reaccepted: { es: "Vuelta a aceptar.", gl: "Volta a aceptar.", en: "Re-accepted." },
  reacceptedUnsent: {
    es: "Vuelta a aceptar (sin enviar).",
    gl: "Volta a aceptar (sen enviar).",
    en: "Re-accepted (unsent).",
  },
  reject: { es: "Rechazar", gl: "Rexeitar", en: "Reject" },
  rejectedUnsentStatus: {
    es: "rechazada (sin enviar)",
    gl: "rexeitada (sen enviar)",
    en: "rejected (unsent)",
  },
  rejectedUnsentToast: {
    es: "Rechazada (sin enviar).",
    gl: "Rexeitada (sen enviar).",
    en: "Rejected (unsent).",
  },
  removeAction: { es: "Quitar", gl: "Quitar", en: "Remove" },
  removeOption: { es: "Quitar opción", gl: "Quitar opción", en: "Remove option" },
  responsesLabel: { es: "Respuestas", gl: "Respostas", en: "Responses" },
  responsesTabLabel: { es: "Respuestas", gl: "Respostas", en: "Responses" },
  revert: { es: "Revertir", gl: "Reverter", en: "Revert" },
  revertedToAcceptedInternal: {
    es: "Revertida a aceptada (interna).",
    gl: "Revertida a aceptada (interna).",
    en: "Reverted to accepted (internal).",
  },
  revertedToRejectedInternal: {
    es: "Revertida a rechazada (interna).",
    gl: "Revertida a rexeitada (interna).",
    en: "Reverted to rejected (internal).",
  },
  reviewSaved: {
    es: "Tu evaluación se ha guardado.",
    gl: "A túa avaliación gardouse.",
    en: "Your review was saved.",
  },
  reviewsWord: { es: "evaluaciones", gl: "avaliacións", en: "reviews" },
  reviewWord: { es: "evaluación", gl: "avaliación", en: "review" },
  reviewWriteOnlyHint: {
    es: "Solo escritura: la API no tiene lectura por evaluador, así que empieza en blanco y sobrescribe tu puntuación anterior al guardar.",
    gl: "Só escritura: a API non ten lectura por avaliador, así que comeza en branco e sobrescribe a túa puntuación anterior ao gardar.",
    en: "Write-only: the API has no per-reviewer read, so this starts blank and overwrites your previous score on save.",
  },
  revokeSpot: { es: "Revocar plaza", gl: "Revogar praza", en: "Revoke spot" },
  saveAnswers: { es: "Guardar respuestas", gl: "Gardar respostas", en: "Save answers" },
  saveMyReview: {
    es: "Guardar mi evaluación",
    gl: "Gardar a miña avaliación",
    en: "Save my review",
  },
  saveNotes: { es: "Guardar notas", gl: "Gardar notas", en: "Save notes" },
  saveQuestions: { es: "Guardar preguntas", gl: "Gardar preguntas", en: "Save questions" },
  scoreColumn: { es: "Puntuación", gl: "Puntuación", en: "Score" },
  scoreMustBeWhole: {
    es: "La puntuación debe ser un número entero entre 0 y 100.",
    gl: "A puntuación debe ser un número enteiro entre 0 e 100.",
    en: "Score must be a whole number between 0 and 100.",
  },
  scoreRangeLabel: { es: "Puntuación (0–100)", gl: "Puntuación (0–100)", en: "Score (0–100)" },
  searchByNameOrEmailPlaceholder: {
    es: "Buscar por nombre o correo…",
    gl: "Buscar por nome ou correo…",
    en: "Search by name or email…",
  },
  send: { es: "Enviar", gl: "Enviar", en: "Send" },
  sendDecision: { es: "Enviar decisión", gl: "Enviar decisión", en: "Send decision" },
  sendDecisions: { es: "Enviar decisiones", gl: "Enviar decisións", en: "Send decisions" },
  sendDecisionsDesc: {
    es: "Envía por correo todas las decisiones pendientes. Los aceptados reciben un enlace para confirmar su plaza.",
    gl: "Envía por correo todas as decisións pendentes. Os aceptados reciben unha ligazón para confirmar a súa praza.",
    en: "Emails every unsent decision. Accepted applicants get a spot-confirmation link.",
  },
  sendNow: { es: "Enviar ahora", gl: "Enviar agora", en: "Send now" },
  sentDecisions: {
    es: "Se enviaron {sent} decisión(es).",
    gl: "Enviáronse {sent} decisión(s).",
    en: "Sent {sent} decision(s).",
  },
  sentDecisionsWithLinks: {
    es: "Se enviaron {sent} decisión(es) ({tokenCount} con enlace de confirmación).",
    gl: "Enviáronse {sent} decisión(s) ({tokenCount} con ligazón de confirmación).",
    en: "Sent {sent} decision(s) ({tokenCount} with confirm links).",
  },
  sharedStaffNotes: {
    es: "Notas compartidas del equipo",
    gl: "Notas compartidas do equipo",
    en: "Shared staff notes",
  },
  shirtSizeRequiredDesc: {
    es: "Los solicitantes de este tipo deben indicar la talla de camiseta.",
    gl: "Os solicitantes deste tipo deben indicar a talla de camiseta.",
    en: "Applicants of this type must supply a shirt size.",
  },
  shownToApplicantsPlaceholder: {
    es: "Se muestra a los solicitantes (opcional)…",
    gl: "Móstrase aos solicitantes (opcional)…",
    en: "Shown to applicants (optional)…",
  },
  spotConfirmed: { es: "Plaza confirmada.", gl: "Praza confirmada.", en: "Spot confirmed." },
  spotDeclined: { es: "Plaza rechazada.", gl: "Praza rexeitada.", en: "Spot declined." },
  spotRevoked: { es: "Plaza revocada.", gl: "Praza revogada.", en: "Spot revoked." },
  spotsRevoked: { es: "Plazas revocadas.", gl: "Prazas revogadas.", en: "Spots revoked." },
  staffNotesSaved: {
    es: "Notas del equipo guardadas.",
    gl: "Notas do equipo gardadas.",
    en: "Staff notes saved.",
  },
  statusColumn: { es: "Estado", gl: "Estado", en: "Status" },
  submissionsAppearHereDesc: {
    es: "Las solicitudes aparecerán aquí en cuanto los solicitantes completen el formulario.",
    gl: "As solicitudes aparecerán aquí en canto os solicitantes completen o formulario.",
    en: "Submissions appear here once applicants complete the form.",
  },
  submittedColumn: { es: "Enviada", gl: "Enviada", en: "Submitted" },
  toAcceptedUnsend: {
    es: "A aceptada (deshacer envío)",
    gl: "A aceptada (desfacer envío)",
    en: "To accepted (unsend)",
  },
  toRejectedUnsend: {
    es: "A rechazada (deshacer envío)",
    gl: "A rexeitada (desfacer envío)",
    en: "To rejected (unsend)",
  },
  tshirtSize: { es: "Camiseta {size}", gl: "Camiseta {size}", en: "T-shirt {size}" },
  universityPickerPlaceholder: {
    es: "Selector de universidad",
    gl: "Selector de universidade",
    en: "University picker",
  },
  unsentSentHint: {
    es: "{unsent} sin enviar · {sent} enviadas",
    gl: "{unsent} sen enviar · {sent} enviadas",
    en: "{unsent} unsent · {sent} sent",
  },
  valueLabel: { es: "valor", gl: "valor", en: "value" },
  visibleToAllReviewersPlaceholder: {
    es: "Visible para todos los evaluadores…",
    gl: "Visible para todos os avaliadores…",
    en: "Visible to all reviewers…",
  },
  yesNoText: { es: "Sí / No", gl: "Si / Non", en: "Yes / No" },
  yourReview: { es: "Tu evaluación", gl: "A túa avaliación", en: "Your review" },

  // ---- Judging panel: room queue widgets ----
  readyStatus: { es: "Listo", gl: "Preparado", en: "Ready" },
  presentingNow: { es: "Presentando ahora", gl: "Presentando agora", en: "Presenting now" },
  inTheRoom: { es: "En la sala", gl: "Na sala", en: "In the room" },
  roomEmptyLabel: { es: "Sala vacía", gl: "Sala baleira", en: "Room empty" },
  emptyLabel: { es: "Vacío", gl: "Baleiro", en: "Empty" },
  nextInQueue: { es: "Siguiente en la cola", gl: "Seguinte na cola", en: "Next in queue" },
  waitingCountSuffix: { es: "{count} esperando", gl: "{count} agardando", en: "{count} waiting" },
  judgingRoomsTitle: { es: "Salas de evaluación", gl: "Salas de avaliación", en: "Judging rooms" },
  judgingRoomsEmptyDesc: {
    es: "Las salas de evaluación aparecerán aquí cuando se configuren.",
    gl: "As salas de avaliación aparecerán aquí cando se configuren.",
    en: "Judging rooms will appear here when they are configured.",
  },
  scheduleEmptyDesc: {
    es: "El programa aparecerá aquí cuando se publique.",
    gl: "O programa aparecerá aquí cando se publique.",
    en: "The schedule will appear here when published.",
  },
  sponsorsEmptyDesc: {
    es: "Los patrocinadores aparecerán aquí cuando se publiquen.",
    gl: "Os patrocinadores aparecerán aquí cando se publiquen.",
    en: "Sponsors will appear here when published.",
  },
  wifiDetailsFallback: { es: "Detalles de Wi-Fi", gl: "Detalles de Wi-Fi", en: "Wi-Fi details" },
  networkLabel: { es: "Red", gl: "Rede", en: "Network" },
  eventTimerTitle: { es: "Cronómetro del evento", gl: "Cronómetro do evento", en: "Event timer" },
  announcementEmptyDesc: {
    es: "No hay avisos activos.",
    gl: "Non hai avisos activos.",
    en: "There are no active announcements.",
  },
  tvReconnecting: {
    es: "La pantalla se está reconectando al servicio del evento.",
    gl: "A pantalla estase reconectando ao servizo do evento.",
    en: "The display is reconnecting to the event service.",
  },
  loadingTvDisplay: {
    es: "Cargando pantalla de TV",
    gl: "Cargando pantalla de TV",
    en: "Loading TV display",
  },
  groupSharedQueue: {
    es: "{count} salas · cola compartida",
    gl: "{count} salas · cola compartida",
    en: "{count} rooms · shared queue",
  },
  backToEvent: { es: "Volver al evento", gl: "Volver ao evento", en: "Back to event" },
  loadingChallenge: { es: "Cargando reto", gl: "Cargando reto", en: "Loading challenge" },
  challengeUnpublishedDesc: {
    es: "Puede que se haya despublicado o que el enlace sea incorrecto.",
    gl: "Pode que se despublicase ou que a ligazón sexa incorrecta.",
    en: "It may have been unpublished or the link is incorrect.",
  },
  judgingCriteriaTitle: {
    es: "Criterios de evaluación",
    gl: "Criterios de avaliación",
    en: "Judging criteria",
  },
  teamFallback: { es: "Equipo", gl: "Equipo", en: "Team" },
  windowInactive: { es: "Inactivo", gl: "Inactivo", en: "Inactive" },
  windowScheduled: { es: "Programado", gl: "Programado", en: "Scheduled" },
  windowClosed: { es: "Cerrado", gl: "Pechado", en: "Closed" },
  windowOpen: { es: "Abierto", gl: "Aberto", en: "Open" },
  matchedLabel: { es: "Emparejado", gl: "Emparellado", en: "Matched" },
  matchedSecondaryLabel: {
    es: "Emparejado (secundario)",
    gl: "Emparellado (secundario)",
    en: "Matched (secondary)",
  },
  allPermissionsLabel: { es: "Todos los permisos", gl: "Todos os permisos", en: "All permissions" },
  statusDraft: { es: "Borrador", gl: "Borrador", en: "Draft" },
  statusSubmitted: { es: "Enviada", gl: "Enviada", en: "Submitted" },
  statusInReview: { es: "En revisión", gl: "En revisión", en: "In review" },
  statusAccepted: { es: "Aceptada", gl: "Aceptada", en: "Accepted" },
  statusNotSelected: { es: "No seleccionada", gl: "Non seleccionada", en: "Not selected" },
  applicationStatusExpired: { es: "Caducada", gl: "Caducada", en: "Expired" },
  firstScanLabel: { es: "Primer escaneo", gl: "Primeiro escaneo", en: "First scan" },
  repeatScanTotal: {
    es: "Escaneo repetido · {count} en total",
    gl: "Escaneo repetido · {count} en total",
    en: "Repeat scan · {count} total",
  },
  repeatBadge: { es: "Repetido", gl: "Repetido", en: "Repeat" },
  registeredBadge: { es: "Registrado", gl: "Rexistrado", en: "Registered" },
  genericSearchPlaceholder: { es: "Buscar…", gl: "Buscar…", en: "Search…" },
  noResultsLabel: { es: "Sin resultados.", gl: "Sen resultados.", en: "No results." },
  removeItemLabel: { es: "Quitar {name}", gl: "Quitar {name}", en: "Remove {name}" },
  filterPlaceholder: { es: "Filtrar…", gl: "Filtrar…", en: "Filter…" },
  hackingStartsIn: {
    es: "El hackathon empieza en",
    gl: "O hackathon comeza en",
    en: "Hacking starts in",
  },
  hackingWindow: { es: "Ventana de hackathon", gl: "Ventá de hackathon", en: "Hacking window" },
  judgingStartsIn: {
    es: "La evaluación empieza en",
    gl: "A avaliación comeza en",
    en: "Judging starts in",
  },
  judgingEndsIn: {
    es: "La evaluación termina en",
    gl: "A avaliación remata en",
    en: "Judging ends in",
  },
  publicEventUnavailable: {
    es: "La información pública del evento no está disponible temporalmente.",
    gl: "A información pública do evento non está dispoñible temporalmente.",
    en: "The public event information is temporarily unavailable.",
  },
  loadingPublicEventInfo: {
    es: "Cargando información pública del evento",
    gl: "Cargando información pública do evento",
    en: "Loading public event information",
  },
  hackathonPlatformTagline: {
    es: "hackOS — plataforma de gestión de hackathons",
    gl: "hackOS — plataforma de xestión de hackathons",
    en: "hackOS — hackathon management platform",
  },
  enterpriseUpdated: {
    es: "Empresa actualizada.",
    gl: "Empresa actualizada.",
    en: "Enterprise updated.",
  },
  scheduleManageDesc: {
    es: "Crea eventos del calendario y muestra u oculta el programa público en lote.",
    gl: "Crea eventos do calendario e amosa ou agocha o programa público en lote.",
    en: "Create event calendar items and batch show/hide them on the public agenda.",
  },
  projectMembersDesc: {
    es: "Composición del equipo y asignaciones de cola de este proyecto.",
    gl: "Composición do equipo e asignacións de cola deste proxecto.",
    en: "Current team membership and queue assignments for this project.",
  },
  devpostImportDesc: {
    es: "Sube o pega las dos exportaciones CSV de Devpost. La vista previa es de solo lectura — no se escribe nada hasta que confirmes.",
    gl: "Sube ou pega as dúas exportacións CSV de Devpost. A vista previa é de só lectura — non se escribe nada ata que confirmes.",
    en: "Upload or paste the two Devpost CSV exports. Preview is read-only — nothing is written until you confirm.",
  },
  viewFileLabel: { es: "Ver archivo", gl: "Ver ficheiro", en: "View file" },
  egPrefix: { es: "p. ej.", gl: "p. ex.", en: "e.g." },
};

const messages: Record<Language, Record<string, string>> = { es: {}, gl: {}, en: {} };
for (const [key, text] of Object.entries(dict)) {
  messages.es[key] = text.es;
  messages.gl[key] = text.gl;
  messages.en[key] = text.en;
}

interface LocaleContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}
const LocaleContext = createContext<LocaleContextValue | null>(null);

function initialLanguage(): Language {
  if (typeof window === "undefined") return "es";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLanguage(stored)) return stored;
  return navigator.language.toLowerCase().startsWith("gl")
    ? "gl"
    : navigator.language.toLowerCase().startsWith("en")
      ? "en"
      : "es";
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  useEffect(() => {
    if (isLanguage(me?.language)) setLanguage(me.language);
  }, [me?.language]);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, values) => {
        let text: string = messages[language][key] ?? key;
        for (const [name, value] of Object.entries(values ?? {}))
          text = text.replace(`{${name}}`, String(value));
        return text;
      },
    }),
    [language],
  );
  return createElement(LocaleContext.Provider, { value }, children);
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}

/** Pick the best available string for a language, falling back gracefully. */
export function pickText(text: I18nText | null | undefined, lang: Language = "es"): string {
  if (!text) return "";
  return text[lang] || LANGS.map((l) => text[l]).find(Boolean) || "";
}

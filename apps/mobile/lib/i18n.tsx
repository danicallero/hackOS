import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type Lang = "en" | "es" | "gl";
type I18nText = Record<Lang, string>;

/**
 * Minimal mobile i18n (H7's language preference applies here too). Structured
 * the same `{ en, es, gl }`-per-key shape as apps/web/src/lib/i18n.ts, but
 * only the strings Phase 1 screens need — not a port of the full web dict.
 */
const dict = {
  signInTitle: { en: "Sign in", es: "Iniciar sesión", gl: "Iniciar sesión" },
  welcomeBack: { en: "Welcome back", es: "Te damos la bienvenida", gl: "Benvida de novo" },
  signInSubtitle: {
    en: "Everything you need during the event.",
    es: "Todo lo que necesitas durante el evento.",
    gl: "Todo o que necesitas durante o evento.",
  },
  eventCompanionSubtitle: {
    en: "Your companion app for the event.",
    es: "Tu aplicación de apoyo durante el evento.",
    gl: "A túa aplicación de apoio durante o evento.",
  },
  eventAccessNotice: {
    en: "For accepted participants and event team members. Sign in with the same email and password you use on {website}. Need help? Contact the organization.",
    es: "Para participantes aceptados y miembros del equipo del evento. Entra con el mismo correo y contraseña que usas en {website}. ¿Necesitas ayuda? Contacta con la organización.",
    gl: "Para participantes aceptados e membros do equipo do evento. Entra co mesmo correo e contrasinal que usas en {website}. Necesitas axuda? Contacta coa organización.",
  },
  mobileAccessDenied: {
    en: "This account doesn't have access to the event app yet. Access is available to accepted participants and event team members.",
    es: "Esta cuenta todavía no tiene acceso a la app del evento. El acceso está disponible para participantes aceptados y miembros del equipo.",
    gl: "Esta conta aínda non ten acceso á app do evento. O acceso está dispoñible para participantes aceptados e membros do equipo.",
  },
  emailLabel: { en: "Email", es: "Correo", gl: "Correo" },
  emailPlaceholder: {
    en: "you@example.com",
    es: "tu@ejemplo.com",
    gl: "ti@exemplo.com",
  },
  passwordLabel: { en: "Password", es: "Contraseña", gl: "Contrasinal" },
  passwordPlaceholder: {
    en: "Enter your password",
    es: "Introduce tu contraseña",
    gl: "Introduce o teu contrasinal",
  },
  signInButton: { en: "Sign in", es: "Entrar", gl: "Entrar" },
  forgotPassword: {
    en: "Forgot password?",
    es: "¿Has olvidado la contraseña?",
    gl: "Esqueciches o contrasinal?",
  },
  signInError: {
    en: "Couldn't sign in — check your email and password.",
    es: "No se pudo iniciar sesión — revisa tu correo y contraseña.",
    gl: "Non se puido iniciar sesión — revisa o teu correo e contrasinal.",
  },
  resetPassword: {
    en: "Reset your password",
    es: "Restablece la contraseña",
    gl: "Restablece o contrasinal",
  },
  resetPasswordDescription: {
    en: "Enter your account email and we'll send you a secure reset link.",
    es: "Introduce el correo de tu cuenta y te enviaremos un enlace seguro.",
    gl: "Introduce o correo da túa conta e enviarémosche unha ligazón segura.",
  },
  sendResetLink: { en: "Send reset link", es: "Enviar enlace", gl: "Enviar ligazón" },
  checkEmail: { en: "Check your email", es: "Revisa tu correo", gl: "Revisa o teu correo" },
  resetEmailSent: {
    en: "If an account exists for that address, we've sent a link to reset your password.",
    es: "Si existe una cuenta con esa dirección, hemos enviado un enlace para restablecer la contraseña.",
    gl: "Se existe unha conta con ese enderezo, enviamos unha ligazón para restablecer o contrasinal.",
  },
  couldNotSendResetEmail: {
    en: "We couldn't send the reset email. Try again.",
    es: "No pudimos enviar el correo. Inténtalo de nuevo.",
    gl: "Non puidemos enviar o correo. Téntao de novo.",
  },
  backToSignIn: {
    en: "Back to sign in",
    es: "Volver al inicio de sesión",
    gl: "Volver ao inicio de sesión",
  },
  setNewPassword: {
    en: "Set a new password",
    es: "Establece una contraseña nueva",
    gl: "Establece un contrasinal novo",
  },
  newPasswordDescription: {
    en: "Use at least 8 characters. Your other sessions will be signed out.",
    es: "Usa al menos 8 caracteres. Se cerrarán tus otras sesiones.",
    gl: "Usa polo menos 8 caracteres. Pecharanse as túas outras sesións.",
  },
  newPassword: { en: "New password", es: "Nueva contraseña", gl: "Novo contrasinal" },
  confirmPassword: {
    en: "Confirm password",
    es: "Confirmar contraseña",
    gl: "Confirmar contrasinal",
  },
  passwordTooShort: {
    en: "Use at least 8 characters.",
    es: "Usa al menos 8 caracteres.",
    gl: "Usa polo menos 8 caracteres.",
  },
  passwordsDontMatch: {
    en: "Passwords don't match.",
    es: "Las contraseñas no coinciden.",
    gl: "Os contrasinais non coinciden.",
  },
  updatePassword: {
    en: "Update password",
    es: "Actualizar contraseña",
    gl: "Actualizar contrasinal",
  },
  resetTokenMissing: {
    en: "This reset link is missing, invalid, or expired.",
    es: "Este enlace no existe, no es válido o ha caducado.",
    gl: "Esta ligazón non existe, non é válida ou caducou.",
  },
  resetLinkInvalid: {
    en: "This reset link is invalid or has expired.",
    es: "Este enlace no es válido o ha caducado.",
    gl: "Esta ligazón non é válida ou caducou.",
  },
  requestAnotherLink: {
    en: "Request another link",
    es: "Solicitar otro enlace",
    gl: "Solicitar outra ligazón",
  },
  passwordUpdatedTitle: {
    en: "Password updated",
    es: "Contraseña actualizada",
    gl: "Contrasinal actualizado",
  },
  passwordUpdated: {
    en: "Your password is ready. Sign in with the new one.",
    es: "Tu contraseña está lista. Inicia sesión con la nueva.",
    gl: "O teu contrasinal está listo. Inicia sesión co novo.",
  },
  tabSchedule: { en: "Schedule", es: "Horario", gl: "Horario" },
  tabQueue: { en: "My queue", es: "Mi turno", gl: "A miña quenda" },
  tabWallet: { en: "Wallet", es: "Cartera", gl: "Carteira" },
  tabNotifications: { en: "Alerts", es: "Avisos", gl: "Avisos" },
  tabAccount: { en: "Account", es: "Cuenta", gl: "Conta" },
  tabScan: { en: "Scanners", es: "Escáneres", gl: "Escáneres" },
  tabActivities: { en: "Activities", es: "Actividades", gl: "Actividades" },
  tabOthers: { en: "Others", es: "Otros", gl: "Outros" },
  loading: { en: "Loading…", es: "Cargando…", gl: "Cargando…" },
  back: { en: "Back", es: "Volver", gl: "Volver" },
  close: { en: "Close", es: "Cerrar", gl: "Pechar" },
  retry: { en: "Retry", es: "Reintentar", gl: "Reintentar" },
  signOut: { en: "Sign out", es: "Cerrar sesión", gl: "Pechar sesión" },
  requestError: {
    en: "Couldn't load this information. Try again.",
    es: "No se pudo cargar esta información. Vuelve a intentarlo.",
    gl: "Non se puido cargar esta información. Téntao de novo.",
  },
  requestServerError: {
    en: "The server is temporarily unavailable. Try again in a moment.",
    es: "El servidor no está disponible temporalmente. Prueba de nuevo en un momento.",
    gl: "O servidor non está dispoñible temporalmente. Proba de novo nun momento.",
  },
  requestUnavailable: {
    en: "This information isn't available for this account yet.",
    es: "Esta información todavía no está disponible para esta cuenta.",
    gl: "Esta información aínda non está dispoñible para esta conta.",
  },
  requestSessionExpired: {
    en: "Your session is no longer valid. Sign out and sign in again.",
    es: "Tu sesión ya no es válida. Cierra sesión y vuelve a entrar.",
    gl: "A túa sesión xa non é válida. Pecha sesión e volve entrar.",
  },
  offlineDataTitle: {
    en: "Offline data — may have changed",
    es: "Datos orientativos — pueden haber cambiado",
    gl: "Datos orientativos — poden ter cambiado",
  },
  offlineDataBody: {
    en: "The server didn't respond. Last successful update: {updatedAt}.",
    es: "El servidor no respondió. Última actualización correcta: {updatedAt}.",
    gl: "O servidor non respondeu. Última actualización correcta: {updatedAt}.",
  },
  accountTitle: { en: "Your account", es: "Tu cuenta", gl: "A túa conta" },
  accountProfile: { en: "Profile", es: "Perfil", gl: "Perfil" },
  accountName: { en: "Name", es: "Nombre", gl: "Nome" },
  accountEmail: { en: "Email", es: "Correo", gl: "Correo" },
  accountLanguage: { en: "Language", es: "Idioma", gl: "Idioma" },
  accountBadge: { en: "Badge", es: "Badge", gl: "Badge" },
  accountNoBadge: { en: "Not assigned yet", es: "Todavía sin asignar", gl: "Aínda sen asignar" },
  accountPhone: { en: "Phone", es: "Teléfono", gl: "Teléfono" },
  accountUniversity: { en: "University", es: "Universidad", gl: "Universidade" },
  accountShirtSize: { en: "Shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
  accountNotSet: { en: "Not set", es: "Sin indicar", gl: "Sen indicar" },
  accountAccredited: { en: "Accredited", es: "Acreditado", gl: "Acreditado" },
  accountNotAccredited: {
    en: "Accreditation pending",
    es: "Acreditación pendiente",
    gl: "Acreditación pendente",
  },
  accountContact: { en: "Contact", es: "Contacto", gl: "Contacto" },
  accountVerified: { en: "Verified", es: "Verificado", gl: "Verificado" },
  accountNotVerified: { en: "Not verified", es: "Sin verificar", gl: "Sen verificar" },
  accountSecondaryEmail: {
    en: "Secondary email",
    es: "Correo secundario",
    gl: "Correo secundario",
  },
  accountEventDetails: { en: "Event details", es: "Datos del evento", gl: "Datos do evento" },
  accountFoodIntolerances: {
    en: "Food intolerances",
    es: "Intolerancias alimentarias",
    gl: "Intolerancias alimentarias",
  },
  accountNoneDeclared: { en: "None declared", es: "Ninguna indicada", gl: "Ningunha indicada" },
  accountDietaryNotes: { en: "Dietary notes", es: "Notas alimentarias", gl: "Notas alimentarias" },
  refreshAccount: { en: "Refresh account", es: "Actualizar cuenta", gl: "Actualizar conta" },
  sessionTitle: { en: "Session", es: "Sesión", gl: "Sesión" },
  sessionActive: {
    en: "Signed in on this device as {email}.",
    es: "Sesión iniciada en este dispositivo como {email}.",
    gl: "Sesión iniciada neste dispositivo como {email}.",
  },
  signOutConfirmTitle: { en: "Sign out?", es: "¿Cerrar sesión?", gl: "Pechar sesión?" },
  signOutConfirmBody: {
    en: "You'll need your email and password to sign in again.",
    es: "Necesitarás tu correo y contraseña para volver a entrar.",
    gl: "Necesitarás o teu correo e contrasinal para volver entrar.",
  },
  signOutError: {
    en: "Couldn't sign out. Try again.",
    es: "No se pudo cerrar la sesión. Vuelve a intentarlo.",
    gl: "Non se puido pechar a sesión. Téntao de novo.",
  },
  scheduleEmpty: {
    en: "Nothing published yet.",
    es: "Todavía no hay nada publicado.",
    gl: "Aínda non hai nada publicado.",
  },
  scheduleEmptyTitle: {
    en: "No schedule yet",
    es: "Todavía no hay horario",
    gl: "Aínda non hai horario",
  },
  scheduleDetails: {
    en: "Activity details",
    es: "Detalles de la actividad",
    gl: "Detalles da actividade",
  },
  scheduleItemUnavailable: {
    en: "This activity is no longer available in the published schedule.",
    es: "Esta actividad ya no está disponible en el programa publicado.",
    gl: "Esta actividade xa non está dispoñible no programa publicado.",
  },
  scheduleTime: { en: "Time", es: "Horario", gl: "Horario" },
  scheduleLocation: { en: "Location", es: "Ubicación", gl: "Localización" },
  scheduleDescription: { en: "Description", es: "Descripción", gl: "Descrición" },
  queueEmpty: {
    en: "You're not in any queue right now.",
    es: "No estás en ninguna cola ahora mismo.",
    gl: "Non estás en ningunha cola agora mesmo.",
  },
  queueEmptyTitle: {
    en: "Your queue is clear",
    es: "Tu cola está vacía",
    gl: "A túa cola está baleira",
  },
  queueAnyMoment: { en: "Any moment", es: "En cualquier momento", gl: "En calquera momento" },
  queuePositionLabel: { en: "Position", es: "Posición", gl: "Posición" },
  queueWaitLabel: { en: "Estimated wait", es: "Espera estimada", gl: "Espera estimada" },
  queuePossibleRooms: {
    en: "Possible rooms: {rooms}",
    es: "Salas posibles: {rooms}",
    gl: "Salas posibles: {rooms}",
  },
  queuePossibleRoomsLabel: { en: "Possible rooms", es: "Salas posibles", gl: "Salas posibles" },
  queueStatusWaiting: { en: "Waiting", es: "En espera", gl: "En espera" },
  queueStatusCalled: { en: "Called", es: "Llamado", gl: "Chamado" },
  queueStatusInRoom: { en: "In room", es: "En sala", gl: "Na sala" },
  queueStatusPresenting: { en: "Presenting", es: "Presentando", gl: "Presentando" },
  queueStatusCompleted: { en: "Completed", es: "Completado", gl: "Completado" },
  queueStatusDisqualified: { en: "Disqualified", es: "Descalificado", gl: "Descualificado" },
  queueCalled: { en: "Go to room {room}", es: "Ve a la sala {room}", gl: "Vai á sala {room}" },
  queuePrecalled: {
    en: "You're up soon — get ready",
    es: "Te toca pronto — prepárate",
    gl: "Tócache pronto — prepárate",
  },
  queuePosition: { en: "Position {n}", es: "Posición {n}", gl: "Posición {n}" },
  ticketLabel: { en: "Ticket", es: "Entrada", gl: "Entrada" },
  badgeLabel: { en: "Badge", es: "Badge", gl: "Badge" },
  noTicketYet: {
    en: "Confirm your accepted spot to receive your ticket.",
    es: "Confirma tu plaza aceptada para recibir tu entrada.",
    gl: "Confirma a túa praza aceptada para recibir a entrada.",
  },
  ticketNotReadyTitle: {
    en: "Ticket not ready",
    es: "Entrada no disponible",
    gl: "Entrada non dispoñible",
  },
  walletConfirmSpotTitle: {
    en: "Confirm your spot",
    es: "Confirma tu plaza",
    gl: "Confirma a túa praza",
  },
  walletConfirmSpotDescription: {
    en: "You've been accepted. Confirm now to secure your place and create your event ticket.",
    es: "Has sido aceptado. Confirma ahora para asegurar tu plaza y crear tu entrada para el evento.",
    gl: "Fuches aceptado. Confirma agora para asegurar a túa praza e crear a entrada para o evento.",
  },
  walletConfirmSpotAction: {
    en: "Accept my spot",
    es: "Aceptar mi plaza",
    gl: "Aceptar a miña praza",
  },
  walletConfirmSpotDeadline: {
    en: "Confirm before {date}.",
    es: "Confirma antes del {date}.",
    gl: "Confirma antes do {date}.",
  },
  noBadgeYet: {
    en: "You don't have a badge yet — get accredited at check-in.",
    es: "Todavía no tienes badge — acredítate en el check-in.",
    gl: "Aínda non tes badge — acredítate no check-in.",
  },
  badgeNotReadyTitle: {
    en: "Badge not ready",
    es: "Badge no disponible",
    gl: "Badge non dispoñible",
  },
  walletScanHint: {
    en: "Show this code to event staff when asked.",
    es: "Muestra este código al personal cuando te lo pidan.",
    gl: "Amosa este código ao persoal cando cho pidan.",
  },
  walletHolder: { en: "Holder", es: "Titular", gl: "Titular" },
  walletHolderName: { en: "Name", es: "Nombre", gl: "Nome" },
  walletHolderRole: { en: "Role", es: "Rol", gl: "Rol" },
  walletAddPass: { en: "Add pass", es: "Añadir pase", gl: "Engadir pase" },
  walletAddPassHint: {
    en: "Wallet passes update automatically when your event credentials change.",
    es: "Los pases se actualizan automáticamente si cambian tus credenciales.",
    gl: "Os pases actualízanse automaticamente se cambian as túas credenciais.",
  },
  walletPassAlreadyAddedTitle: {
    en: "Already in Apple Wallet",
    es: "Ya está en Apple Wallet",
    gl: "Xa está en Apple Wallet",
  },
  walletPassAlreadyAddedBody: {
    en: "This pass is already in Apple Wallet. It updates automatically when its details change, so you don't need to add it again.",
    es: "Este pase ya está en Apple Wallet. Se actualiza automáticamente cuando cambia algún dato, así que no necesitas volver a añadirlo.",
    gl: "Este pase xa está en Apple Wallet. Actualízase automaticamente cando cambia algún dato, así que non necesitas engadilo de novo.",
  },
  addToAppleWallet: {
    en: "Add to Apple Wallet",
    es: "Añadir a Apple Wallet",
    gl: "Engadir a Apple Wallet",
  },
  addToGoogleWallet: {
    en: "Add to Google Wallet",
    es: "Añadir a Google Wallet",
    gl: "Engadir a Google Wallet",
  },
  notificationsMandatoryHint: {
    en: "Queue-call notices are always sent — they aren't optional.",
    es: "Los avisos de turno de cola siempre se envían — no son opcionales.",
    gl: "Os avisos de quenda de cola sempre se envían — non son opcionais.",
  },
  notificationsMessages: { en: "Messages", es: "Mensajes", gl: "Mensaxes" },
  notificationsPreferences: { en: "Preferences", es: "Preferencias", gl: "Preferencias" },
  notificationsUnreadOnly: { en: "Unread only", es: "Solo sin leer", gl: "Só sen ler" },
  notificationsUnreadHint: {
    en: "Open a message to mark it as read.",
    es: "Abre un mensaje para marcarlo como leído.",
    gl: "Abre unha mensaxe para marcala como lida.",
  },
  notificationsNoUnread: { en: "You're all caught up", es: "Estás al día", gl: "Estás ao día" },
  notificationsEmptyTitle: {
    en: "No messages yet",
    es: "Todavía no hay mensajes",
    gl: "Aínda non hai mensaxes",
  },
  notificationsEmptyHint: {
    en: "Announcements and important event updates will appear here.",
    es: "Los anuncios y avisos importantes aparecerán aquí.",
    gl: "Os anuncios e avisos importantes aparecerán aquí.",
  },
  notificationsShowingLatest: {
    en: "Showing the latest {count} of {total} messages.",
    es: "Mostrando los últimos {count} de {total} mensajes.",
    gl: "Amosando as últimas {count} de {total} mensaxes.",
  },
  refreshNotifications: {
    en: "Refresh notifications",
    es: "Actualizar avisos",
    gl: "Actualizar avisos",
  },
  notificationsRequired: { en: "Required", es: "Obligatorias", gl: "Obrigatorias" },
  queueCalls: { en: "Queue calls", es: "Avisos de turno", gl: "Avisos de quenda" },
  notificationsAlwaysOn: { en: "Always on", es: "Siempre activo", gl: "Sempre activo" },
  notificationsAnnouncements: { en: "Announcements", es: "Anuncios", gl: "Anuncios" },
  notificationsApplications: {
    en: "Application updates",
    es: "Cambios de candidatura",
    gl: "Cambios da candidatura",
  },
  notificationsInApp: { en: "In-app inbox", es: "Bandeja de la app", gl: "Bandexa da app" },
  notificationsPush: {
    en: "Push notifications",
    es: "Notificaciones push",
    gl: "Notificacións push",
  },
  scheduleReminderOn: {
    en: "Reminder on for {name}",
    es: "Recordatorio activado para {name}",
    gl: "Lembranza activada para {name}",
  },
  scheduleReminderOff: {
    en: "Reminder off for {name}",
    es: "Recordatorio desactivado para {name}",
    gl: "Lembranza desactivada para {name}",
  },
  scheduleShowLess: { en: "Show less", es: "Ver menos", gl: "Ver menos" },
  scheduleShowMore: { en: "Show more", es: "Ver más", gl: "Ver máis" },
  save: { en: "Save", es: "Guardar", gl: "Gardar" },
  saved: { en: "Saved", es: "Guardado", gl: "Gardado" },
  scannerAccreditation: { en: "Accreditation", es: "Acreditación", gl: "Acreditación" },
  scannerBadge: { en: "Replace badge", es: "Reponer badge", gl: "Repoñer badge" },
  scannerPresence: { en: "Presence", es: "Presencia", gl: "Presenza" },
  scannerMeals: {
    en: "Meals / activities",
    es: "Comidas / actividades",
    gl: "Comidas / actividades",
  },
  scannerSync: { en: "Sync now", es: "Sincronizar", gl: "Sincronizar" },
  scannerSyncing: { en: "Syncing…", es: "Sincronizando…", gl: "Sincronizando…" },
  scannerStateReady: { en: "Ready", es: "Listo", gl: "Listo" },
  scannerStateSaved: {
    en: "Saved on this device",
    es: "Guardado en este dispositivo",
    gl: "Gardado neste dispositivo",
  },
  scannerStateConfirmed: { en: "Confirmed", es: "Confirmado", gl: "Confirmado" },
  scannerStateAttention: {
    en: "Needs attention",
    es: "Necesita atención",
    gl: "Precisa atención",
  },
  scannerAwaitingAcknowledgement: {
    en: "Waiting for server acknowledgement.",
    es: "Esperando la confirmación del servidor.",
    gl: "Agardando a confirmación do servidor.",
  },
  scannerOfflineWaiting: {
    en: "Still saved; connection retry pending",
    es: "Sigue guardado; pendiente de reintento de conexión",
    gl: "Segue gardado; pendente de reintento da conexión",
  },
  scannerBusinessRejected: {
    en: "Server rejected this operation",
    es: "El servidor rechazó esta operación",
    gl: "O servidor rexeitou esta operación",
  },
  scannerQueueSavedCount: {
    en: "Saved: {count}",
    es: "Guardados: {count}",
    gl: "Gardados: {count}",
  },
  scannerQueueAttentionCount: {
    en: "Needs attention: {count}",
    es: "Necesitan atención: {count}",
    gl: "Precisan atención: {count}",
  },
  scannerOfflineCount: {
    en: "Waiting for connection: {count}",
    es: "Esperando conexión: {count}",
    gl: "Agardando conexión: {count}",
  },
  scannerNeverSynced: {
    en: "Never synchronized",
    es: "Nunca sincronizado",
    gl: "Nunca sincronizado",
  },
  scannerLastSync: {
    en: "Last sync: {time}",
    es: "Última sync: {time}",
    gl: "Última sync: {time}",
  },
  scannerTicket: { en: "Ticket QR", es: "QR de entrada", gl: "QR da entrada" },
  scannerBadgeId: { en: "Badge QR", es: "QR del badge", gl: "QR do badge" },
  scannerCurrentBadge: { en: "Current badge", es: "Badge actual", gl: "Badge actual" },
  scannerNewBadge: { en: "New badge", es: "Badge nuevo", gl: "Badge novo" },
  scannerReason: { en: "Reason", es: "Motivo", gl: "Motivo" },
  scannerLookup: { en: "Look up locally", es: "Buscar en local", gl: "Buscar en local" },
  scannerCamera: { en: "Scan QR", es: "Escanear QR", gl: "Escanear QR" },
  scannerCameraAccess: {
    en: "Camera access",
    es: "Acceso a la cámara",
    gl: "Acceso á cámara",
  },
  scannerCameraPermissionBody: {
    en: "The camera is required to scan tickets and badges.",
    es: "La cámara es necesaria para leer entradas y acreditaciones.",
    gl: "A cámara é necesaria para ler entradas e acreditacións.",
  },
  scannerAllowCamera: {
    en: "Allow camera",
    es: "Permitir cámara",
    gl: "Permitir cámara",
  },
  scannerQrHint: {
    en: "Center the QR code inside the frame",
    es: "Centra el código QR dentro del marco",
    gl: "Centra o código QR dentro do marco",
  },
  scannerTurnOnFlashlight: {
    en: "Turn on flashlight",
    es: "Encender linterna",
    gl: "Acender a lanterna",
  },
  scannerTurnOffFlashlight: {
    en: "Turn off flashlight",
    es: "Apagar linterna",
    gl: "Apagar a lanterna",
  },
  scannerConfirmAccreditation: { en: "Assign badge", es: "Asignar badge", gl: "Asignar badge" },
  scannerRotate: { en: "Rotate badge", es: "Rotar badge", gl: "Rotar badge" },
  scannerRegister: { en: "Register scan", es: "Registrar pase", gl: "Rexistrar pase" },
  scannerIn: { en: "Entry", es: "Entrada", gl: "Entrada" },
  scannerOut: { en: "Exit", es: "Salida", gl: "Saída" },
  scannerBackdated: {
    en: "Time (ISO, optional)",
    es: "Hora (ISO, opcional)",
    gl: "Hora (ISO, opcional)",
  },
  scannerSelectActivity: {
    en: "Select an activity",
    es: "Elige una actividad",
    gl: "Escolle unha actividade",
  },
  scannerUnknownTicket: {
    en: "Ticket not found in the local copy.",
    es: "La entrada no está en la copia local.",
    gl: "A entrada non está na copia local.",
  },
  scannerUnknownBadge: {
    en: "Badge not found in the local copy.",
    es: "El badge no está en la copia local.",
    gl: "O badge non está na copia local.",
  },
  scannerRevokedBadge: {
    en: "REJECTED: this badge is revoked.",
    es: "RECHAZADO: este badge está revocado.",
    gl: "REXEITADO: este badge está revogado.",
  },
  scannerPendingAck: {
    en: "Saved locally; waiting for server acknowledgement.",
    es: "Guardado en local; esperando confirmación del servidor.",
    gl: "Gardado en local; agardando confirmación do servidor.",
  },
  scannerAcknowledged: {
    en: "Server acknowledged the scan.",
    es: "El servidor confirmó el pase.",
    gl: "O servidor confirmou o pase.",
  },
  scannerAccreditationPending: {
    en: "NOT CHECKED IN: waiting for the server OK.",
    es: "NO ACREDITADO: esperando el OK real del servidor.",
    gl: "NON ACREDITADO: agardando o OK real do servidor.",
  },
  scannerQueue: { en: "Device queue", es: "Cola del dispositivo", gl: "Cola do dispositivo" },
  scannerRetryFailed: {
    en: "Retry rejected scans",
    es: "Reintentar pases rechazados",
    gl: "Reintentar pases rexeitados",
  },
  scannerNoQueue: {
    en: "No scans stored on this device yet.",
    es: "Todavía no hay pases guardados en este dispositivo.",
    gl: "Aínda non hai pases gardados neste dispositivo.",
  },
  scannerConfirmed: { en: "Confirmed place", es: "Plaza confirmada", gl: "Praza confirmada" },
  scannerUnconfirmed: {
    en: "Place not confirmed",
    es: "Plaza no confirmada",
    gl: "Praza non confirmada",
  },
  scannerAlreadyCount: {
    en: "Previous scans: {count}",
    es: "Pases anteriores: {count}",
    gl: "Pases anteriores: {count}",
  },
  scannerRepeatTitle: { en: "Already served", es: "Ya se le ha servido", gl: "Xa se lle serviu" },
  scannerRepeatBody: {
    en: "This person already has {count} scan(s). Allow a repeat?",
    es: "Esta persona ya tiene {count} pase(s). ¿Permitir repetición?",
    gl: "Esta persoa xa ten {count} pase(s). Permitir repetición?",
  },
  scannerActivitiesEmpty: {
    en: "No scannable activities",
    es: "No hay actividades escaneables",
    gl: "Non hai actividades escaneables",
  },
  scannerActivitiesEmptyBody: {
    en: "Activities configured to register access will appear here.",
    es: "Las actividades configuradas para registrar accesos aparecerán aquí.",
    gl: "As actividades configuradas para rexistrar accesos aparecerán aquí.",
  },
  scannerMeal: { en: "Meal", es: "Comida", gl: "Comida" },
  scannerActivity: { en: "Activity", es: "Actividad", gl: "Actividade" },
  scannerScanActivity: {
    en: "Scan activity",
    es: "Escanear actividad",
    gl: "Escanear actividade",
  },
  scannerPeople: { en: "People", es: "Personas", gl: "Persoas" },
  scannerViewPeople: { en: "View people", es: "Ver personas", gl: "Ver persoas" },
  scannerSearchPerson: { en: "Search for a person", es: "Buscar persona", gl: "Buscar persoa" },
  scannerPeopleSearchPlaceholder: {
    en: "Name, email, or badge",
    es: "Nombre, correo o acreditación",
    gl: "Nome, correo ou acreditación",
  },
  scannerNoResults: { en: "No results", es: "No hay resultados", gl: "Non hai resultados" },
  scannerNoSyncedUsers: {
    en: "No synchronized users",
    es: "No hay usuarios sincronizados",
    gl: "Non hai usuarios sincronizados",
  },
  scannerTryAnotherSearch: {
    en: "Try another name, email, or badge.",
    es: "Prueba con otro nombre, correo o acreditación.",
    gl: "Proba con outro nome, correo ou acreditación.",
  },
  scannerRefreshDirectory: {
    en: "Refresh the scanner to download the directory.",
    es: "Actualiza el escáner para descargar el directorio.",
    gl: "Actualiza o escáner para descargar o directorio.",
  },
  scannerNoBadge: { en: "No badge", es: "Sin acreditación", gl: "Sen acreditación" },
  scannerViewPerson: { en: "View person", es: "Ver persona", gl: "Ver persoa" },
  roleAll: { en: "All", es: "Todos", gl: "Todos" },
  roleAdmin: { en: "Administration", es: "Administración", gl: "Administración" },
  roleJudge: { en: "Judge", es: "Jurado", gl: "Xurado" },
  roleSponsor: { en: "Sponsor", es: "Patrocinio", gl: "Patrocinio" },
  roleStaff: { en: "Staff", es: "Staff", gl: "Staff" },
  roleParticipant: { en: "Participant", es: "Participante", gl: "Participante" },
  roleParticipants: { en: "Participants", es: "Participantes", gl: "Participantes" },
  scannerNoAcceptedPlace: {
    en: "No accepted place",
    es: "Sin plaza aceptada",
    gl: "Sen praza aceptada",
  },
  scannerPlaceUnconfirmed: {
    en: "Place not confirmed",
    es: "Plaza sin confirmar",
    gl: "Praza sen confirmar",
  },
  scannerUnknownQr: {
    en: "This QR code is not recognized",
    es: "No se reconoce este código QR",
    gl: "Non se recoñece este código QR",
  },
  scannerBadgeRevoked: {
    en: "This badge is revoked",
    es: "Esta acreditación está revocada",
    gl: "Esta acreditación está revogada",
  },
  scannerBadgeUnknown: {
    en: "Badge not recognized",
    es: "Acreditación no reconocida",
    gl: "Acreditación non recoñecida",
  },
  scannerRepeatFound: {
    en: "Already scanned here",
    es: "Ya ha pasado por aquí",
    gl: "Xa pasou por aquí",
  },
  scannerRepeatNoAdd: { en: "Do not add", es: "No añadir", gl: "Non engadir" },
  scannerRepeatAdd: { en: "Add another", es: "Añadir otro", gl: "Engadir outro" },
  scannerRegisterAnother: {
    en: "Register another",
    es: "Registrar otro",
    gl: "Rexistrar outro",
  },
  scannerPassRegistered: {
    en: "Pass registered",
    es: "Pase registrado",
    gl: "Pase rexistrado",
  },
  scannerRegisteredPasses: {
    en: "Registered passes: {count}",
    es: "Pases registrados: {count}",
    gl: "Pases rexistrados: {count}",
  },
  scannerTapToContinue: {
    en: "Tap to continue",
    es: "Toca para continuar",
    gl: "Toca para continuar",
  },
  continue: { en: "Continue", es: "Continuar", gl: "Continuar" },
  scannerDietaryGroup: {
    en: "Dietary information",
    es: "Información alimentaria",
    gl: "Información alimentaria",
  },
  scannerServed: { en: "Served", es: "Servidos", gl: "Servidos" },
  scannerPasses: { en: "Passes", es: "Pases", gl: "Pases" },
  scannerRepeats: { en: "Repeats", es: "Repetidos", gl: "Repetidos" },
  personLoading: { en: "Loading person…", es: "Cargando persona…", gl: "Cargando persoa…" },
  personFallbackName: { en: "Person {id}", es: "Persona {id}", gl: "Persoa {id}" },
  personPersonalData: { en: "Personal details", es: "Datos personales", gl: "Datos persoais" },
  personPhone: { en: "Phone", es: "Teléfono", gl: "Teléfono" },
  personDni: { en: "ID document", es: "DNI", gl: "DNI" },
  personShirt: { en: "T-shirt", es: "Camiseta", gl: "Camiseta" },
  personCurrentBadge: {
    en: "Current badge",
    es: "Acreditación actual",
    gl: "Acreditación actual",
  },
  personUnassigned: { en: "Unassigned", es: "Sin asignar", gl: "Sen asignar" },
  personReplaceBadge: {
    en: "Replace badge",
    es: "Sustituir acreditación",
    gl: "Substituír acreditación",
  },
  personLinkBadge: {
    en: "Link badge",
    es: "Enlazar acreditación",
    gl: "Vincular acreditación",
  },
  personDeleteBadge: {
    en: "Delete badge",
    es: "Eliminar acreditación",
    gl: "Eliminar acreditación",
  },
  personDeleteBadgeBody: {
    en: "Badge {badge} will be revoked.",
    es: "La acreditación {badge} quedará revocada.",
    gl: "A acreditación {badge} quedará revogada.",
  },
  personBadgeIsTicketTitle: {
    en: "That's a ticket, not a badge",
    es: "Eso es un ticket, no una acreditación",
    gl: "Iso é un ticket, non unha acreditación",
  },
  personBadgeIsTicketBody: {
    en: "This QR belongs to someone's entrance ticket. Scan the physical badge instead.",
    es: "Este QR pertenece al ticket de entrada de una persona. Escanea la acreditación física en su lugar.",
    gl: "Este QR pertence ao ticket de entrada dunha persoa. Escanea a acreditación física no seu lugar.",
  },
  delete: { en: "Delete", es: "Eliminar", gl: "Eliminar" },
  continueAnyway: {
    en: "Continue anyway",
    es: "Continuar igualmente",
    gl: "Continuar igualmente",
  },
  personUnconfirmedWarning: {
    en: "This person has not confirmed their place yet and should not be accredited.",
    es: "Esta persona todavía no ha confirmado su plaza y no debería acreditarse.",
    gl: "Esta persoa aínda non confirmou a súa praza e non debería acreditarse.",
  },
  personUnacceptedWarning: {
    en: "This person does not have an accepted place and should not be accredited.",
    es: "Esta persona no tiene una plaza aceptada y no debería acreditarse.",
    gl: "Esta persoa non ten unha praza aceptada e non debería acreditarse.",
  },
  personScanNewBadge: {
    en: "Scan the new badge",
    es: "Escanea la nueva acreditación",
    gl: "Escanea a nova acreditación",
  },
  personScanReplacementBadge: {
    en: "Scan the replacement badge",
    es: "Escanea la acreditación de sustitución",
    gl: "Escanea a acreditación de substitución",
  },
  personImportantInfo: {
    en: "Important information",
    es: "Información importante",
    gl: "Información importante",
  },
  personFoodRestrictions: {
    en: "Dietary restrictions",
    es: "Restricciones alimentarias",
    gl: "Restricións alimentarias",
  },
  personFoodNotes: { en: "Dietary notes", es: "Notas alimentarias", gl: "Notas alimentarias" },
  personNotes: { en: "Notes", es: "Notas", gl: "Notas" },
  personPresenceTitle: {
    en: "Entries and exits",
    es: "Entradas y salidas",
    gl: "Entradas e saídas",
  },
  personMovement: { en: "Movement", es: "Movimiento", gl: "Movemento" },
  personRegisterEntry: {
    en: "Register entry",
    es: "Registrar entrada",
    gl: "Rexistrar entrada",
  },
  personRegisterExit: { en: "Register exit", es: "Registrar salida", gl: "Rexistrar saída" },
  edit: { en: "Edit", es: "Editar", gl: "Editar" },
  presenceSummary: { en: "Presence summary", es: "Resumen de presencia", gl: "Resumo de presenza" },
  presenceGuaranteedHours: {
    en: "Guaranteed presence",
    es: "Presencia garantizada",
    gl: "Presenza garantida",
  },
  presenceProvisionalHours: {
    en: "Provisional presence",
    es: "Presencia provisional",
    gl: "Presenza provisional",
  },
  presenceCertaintyWindow: {
    en: "Certainty window",
    es: "Ventana de certeza",
    gl: "Xanela de certeza",
  },
  presenceTimeline: {
    en: "Presence timeline",
    es: "Cronología de presencia",
    gl: "Cronoloxía de presenza",
  },
  presenceTimelineFooter: {
    en: "Each entry or activity opens a certainty window; a later activity or exit secures the elapsed time. Points can be corrected manually.",
    es: "Cada entrada o actividad abre una ventana de certeza; una actividad o salida posterior asegura el tiempo transcurrido. Los puntos se pueden corregir manualmente.",
    gl: "Cada entrada ou actividade abre unha xanela de certeza; unha actividade ou saída posterior asegura o tempo transcorrido. Os puntos pódense corrixir manualmente.",
  },
  presenceCouldNotLoad: {
    en: "The presence timeline couldn't be loaded.",
    es: "No se pudo cargar la cronología de presencia.",
    gl: "Non se puido cargar a cronoloxía de presenza.",
  },
  presenceNoWindows: {
    en: "No presence yet",
    es: "Todavía no hay presencia",
    gl: "Aínda non hai presenza",
  },
  presenceNoWindowsDescription: {
    en: "Add an entry or activity to begin the first certainty window.",
    es: "Añade una entrada o actividad para iniciar la primera ventana de certeza.",
    gl: "Engade unha entrada ou actividade para iniciar a primeira xanela de certeza.",
  },
  presenceSecured: { en: "Secured", es: "Asegurada", gl: "Asegurada" },
  presenceProvisional: { en: "Provisional", es: "Provisional", gl: "Provisional" },
  presenceInvalid: { en: "Not computed", es: "No computada", gl: "Non computada" },
  presenceDeadline: { en: "Until {time}", es: "Hasta {time}", gl: "Ata {time}" },
  presenceSecuredFor: {
    en: "{duration} secured",
    es: "{duration} aseguradas",
    gl: "{duration} aseguradas",
  },
  presenceAddSignal: {
    en: "Add presence point",
    es: "Añadir punto de presencia",
    gl: "Engadir punto de presenza",
  },
  presenceEditSignal: {
    en: "Edit presence point",
    es: "Editar punto de presencia",
    gl: "Editar punto de presenza",
  },
  presenceDeleteSignal: {
    en: "Delete presence point",
    es: "Eliminar punto de presencia",
    gl: "Eliminar punto de presenza",
  },
  presenceDeleteConfirm: {
    en: "This changes the person's computed presence and cannot be undone.",
    es: "Esto modifica la presencia computada de la persona y no se puede deshacer.",
    gl: "Isto modifica a presenza computada da persoa e non se pode desfacer.",
  },
  presenceCouldNotDelete: {
    en: "The presence point couldn't be deleted.",
    es: "No se pudo eliminar el punto de presencia.",
    gl: "Non se puido eliminar o punto de presenza.",
  },
  presenceCouldNotSave: {
    en: "The presence point couldn't be saved. Check its date and try again.",
    es: "No se pudo guardar el punto de presencia. Revisa la fecha e inténtalo de nuevo.",
    gl: "Non se puido gardar o punto de presenza. Revisa a data e téntao de novo.",
  },
  presenceSignalEntry: { en: "Entry", es: "Entrada", gl: "Entrada" },
  presenceSignalExit: { en: "Exit", es: "Salida", gl: "Saída" },
  presenceSignalActivity: { en: "Activity", es: "Actividad", gl: "Actividade" },
  presenceRecordedBy: {
    en: "Recorded by {name}",
    es: "Registrado por {name}",
    gl: "Rexistrado por {name}",
  },
  presenceRecordedBySystem: {
    en: "Recorded automatically",
    es: "Registrado automáticamente",
    gl: "Rexistrado automaticamente",
  },
  presenceConflict: { en: "Conflict", es: "Conflicto", gl: "Conflito" },
  presenceChooseActivity: {
    en: "Choose an activity",
    es: "Elige una actividad",
    gl: "Escolle unha actividade",
  },
  presenceScanRejectedTitle: {
    en: "Log rejected",
    es: "Registro rechazado",
    gl: "Rexistro rexeitado",
  },
  presenceScanRejectedBody: {
    en: "The server rejected this presence log.",
    es: "El servidor rechazó este registro de presencia.",
    gl: "O servidor rexeitou este rexistro de presenza.",
  },
  presenceConflictTitle: {
    en: "Timeline conflict",
    es: "Conflicto en la cronología",
    gl: "Conflito na cronoloxía",
  },
  presenceConflictBody: {
    en: "Two entries with no exit or activity between them ({from} → {to}). No hours are counted for the first entry until the missing point is added.",
    es: "Dos entradas sin salida ni actividad entre ellas ({from} → {to}). No se computan horas de la primera entrada hasta añadir el punto que falta.",
    gl: "Dúas entradas sen saída nin actividade entre elas ({from} → {to}). Non se computan horas da primeira entrada ata engadir o punto que falta.",
  },
  presenceResolveConflict: {
    en: "Resolve timeline gap",
    es: "Resolver el hueco",
    gl: "Resolver o oco",
  },
  presenceConflictBounds: {
    en: "The date is limited to the gap between the two conflicting entries.",
    es: "La fecha está limitada al intervalo entre las dos entradas en conflicto.",
    gl: "A data está limitada ao intervalo entre as dúas entradas en conflito.",
  },
  presenceActivity: {
    en: "Activity or meal",
    es: "Actividad o comida",
    gl: "Actividade ou comida",
  },
  presenceActivityRequired: {
    en: "Choose an activity.",
    es: "Selecciona una actividad.",
    gl: "Selecciona unha actividade.",
  },
  presenceActivityKindLocked: {
    en: "An activity point remains an activity; you can change which activity it belongs to.",
    es: "Un punto de actividad sigue siendo una actividad; puedes cambiar a cuál pertenece.",
    gl: "Un punto de actividade segue sendo unha actividade; podes cambiar a cal pertence.",
  },
  presenceNoActivities: {
    en: "There are no activities available.",
    es: "No hay actividades disponibles.",
    gl: "Non hai actividades dispoñibles.",
  },
  presenceDateAndTime: { en: "Date and time", es: "Fecha y hora", gl: "Data e hora" },
  presenceNotes: { en: "Notes", es: "Notas", gl: "Notas" },
  presenceNotesPlaceholder: {
    en: "Reason for the manual correction (optional)",
    es: "Motivo de la corrección manual (opcional)",
    gl: "Motivo da corrección manual (opcional)",
  },
  presenceMinutesValue: { en: "{minutes} min", es: "{minutes} min", gl: "{minutes} min" },
  presenceWholeHoursValue: { en: "{hours} h", es: "{hours} h", gl: "{hours} h" },
  presenceHoursMinutesValue: {
    en: "{hours} h {minutes} min",
    es: "{hours} h {minutes} min",
    gl: "{hours} h {minutes} min",
  },
  badgeReplacementReason: {
    en: "Replacement from the operations app",
    es: "Sustitución desde la app de operaciones",
    gl: "Substitución desde a app de operacións",
  },
  badgeRemovalReason: {
    en: "Removal from the operations app",
    es: "Retirada desde la app de operaciones",
    gl: "Retirada desde a app de operacións",
  },
  cancel: { en: "Cancel", es: "Cancelar", gl: "Cancelar" },
  confirm: { en: "Confirm", es: "Confirmar", gl: "Confirmar" },
} satisfies Record<string, I18nText>;

type Key = keyof typeof dict;

function interpolate(text: string, vars?: Record<string, string>): string {
  if (!vars) return text;
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), text);
}

interface LocaleContextValue {
  language: Lang;
  setLanguage: (lang: Lang) => void;
  t: (key: Key, vars?: Record<string, string>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Lang>("en");
  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, vars) => interpolate(dict[key][language], vars),
    }),
    [language],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

export function isSupportedLanguage(value: string): value is Lang {
  return value === "en" || value === "es" || value === "gl";
}

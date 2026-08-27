import type { LegalDocumentCopy } from "@/components/legal/localized-legal-document";
import type { Language } from "@/lib/types";

export const privacyCopy: Record<Language, LegalDocumentCopy> = {
  es: {
    title: "Política de privacidad",
    description:
      "Aquí explicamos qué datos trata GPUL a través de hackOS, para qué los utiliza y cómo puedes ejercer tus derechos.",
    updatedAt: "27 de agosto de 2026",
    body: `## 1. Responsable del tratamiento

Esta política se aplica únicamente a la instancia de hackOS operada por GPUL. Una instalación desplegada por otra persona o entidad es una instancia independiente: su operador será responsable del tratamiento y deberá facilitar su propia política de privacidad. GPUL no controla ni trata los datos almacenados en instancias de terceros.

La Asociación Universitaria Grupo de Programadores y Usuarios de Linux (**GPUL**), con NIF G15659220 y domicilio en la Facultad de Informática, Campus de Elviña S/N, 15071 A Coruña, es la responsable del tratamiento de tus datos personales.

hackOS es el sistema oficial de operaciones de GPUL para el evento HackUDC. La inscripción se realiza en una plataforma web externa y no concede por sí sola acceso a hackOS: el acceso se habilita a participantes aceptados y a personal autorizado para gestionar la acreditación, los servicios del evento y la participación. Esta política complementa, sin sustituir, la [política de privacidad general del evento HackUDC, publicada por GPUL](https://hackudc.gpul.org/privacy), que describe el tratamiento de datos del evento en su conjunto.

Puedes contactar con GPUL en esa dirección o mediante [hackudc@gpul.org](mailto:hackudc@gpul.org) para cualquier consulta relacionada con la privacidad.

## 2. Datos que tratamos

Según cómo utilices hackOS, podremos tratar las siguientes categorías:

- **Cuenta e identificación:** nombre, apellidos, correo electrónico, credenciales de acceso protegidas, idioma, imagen de perfil y, cuando sea necesario para la acreditación, documento identificativo y código de acceso.
- **Solicitudes:** respuestas a formularios, universidad, talla de camiseta, currículum o justificantes y otros datos que solicite la convocatoria. Cada formulario identificará qué campos son obligatorios.
- **Datos de salud:** alergias, intolerancias y otras necesidades dietéticas proporcionadas voluntariamente para organizar el catering.
- **Participación:** proyectos, equipos, retos, turnos, acreditaciones, accesos, actividades, evaluaciones y comunicaciones del evento.
- **Datos técnicos y de seguridad:** dirección IP, navegador, sesiones, registros de actividad y datos necesarios para prevenir abusos y resolver incidencias.
- **Comunicaciones:** mensajes, solicitudes de soporte y preferencias de notificación.

Los datos proceden directamente de ti, de personas autorizadas de tu equipo o entidad y de la actividad generada al utilizar hackOS.

Algunos formularios o registros de proyectos pueden pedirte que proporciones enlaces a sitios web externos, como repositorios, demostraciones o portafolios. Esos sitios son independientes de hackOS y GPUL, tienen sus propias políticas de privacidad y no están operados, vinculados ni afiliados con GPUL. Cuando visites esos sitios o les envíes datos, se aplicarán sus propias políticas y condiciones.

## 3. Finalidades y bases jurídicas

- **Gestionar tu cuenta, solicitud y participación:** ejecución de la relación precontractual o contractual derivada de tu inscripción y aceptación de estos términos.
- **Gestionar procesos operativos:** acreditación, horarios, equipos, proyectos, evaluación, logística y comunicaciones; según el caso, por ejecución de la relación de participación o interés legítimo de GPUL.
- **Gestionar datos de salud:** tu consentimiento explícito. Puedes retirarlo, aunque ello puede limitar la adaptación del catering a tus necesidades.
- **Proteger hackOS y cumplir obligaciones legales:** interés legítimo de GPUL en mantener la seguridad y cumplimiento de obligaciones legales aplicables.
- **Enviar información sobre actividades similares:** consentimiento cuando sea exigible o interés legítimo permitido por la normativa. Podrás oponerte en cualquier momento.
- **Publicar imágenes o vídeos identificables:** consentimiento explícito o la base jurídica que se indique al realizar la captación.

## 4. Destinatarios

GPUL configura y controla la autenticación, las bases de datos y el almacenamiento compatible con S3. Estos servicios se ejecutan en infraestructura privada asignada a GPUL y bajo su control lógico, aunque la operación de la infraestructura física subyacente no tenga que realizarse directamente por la Asociación. Los servidores que alojan las cuentas, solicitudes, bases de datos y archivos están ubicados en el Espacio Económico Europeo.

Podremos comunicar datos, limitados a lo necesario, a:

- Administraciones públicas, juzgados y fuerzas de seguridad cuando exista obligación legal.
- **Expo:** si activas las notificaciones push, enviaremos a Expo Push Service el token de notificaciones de tu dispositivo, el título y texto de la notificación y los datos técnicos necesarios para dirigirla dentro de la aplicación. Expo actúa como encargado del tratamiento para entregar el mensaje al servicio de notificaciones del sistema operativo de tu dispositivo.
- Personas patrocinadoras o evaluadoras cuando sea necesario para gestionar un proceso en el que participes o cuando hayas autorizado expresamente compartir tu candidatura o currículum.
- Asesores y auditores cuando sea necesario para cumplir obligaciones legales.

GPUL no vende tus datos personales.

## 5. Transferencias internacionales

El uso de Expo Push Service y de los servicios de notificaciones del sistema operativo puede implicar el tratamiento fuera del Espacio Económico Europeo de los datos necesarios para entregar una notificación. GPUL aplicará las garantías exigidas por la normativa, como una decisión de adecuación o cláusulas contractuales tipo, cuando resulten necesarias.

La información principal de hackOS —incluidas las cuentas, solicitudes, bases de datos y archivos— permanece en infraestructura privada ubicada en el Espacio Económico Europeo y bajo el control lógico de GPUL. Esta información no se transfiere a Expo.

## 6. Conservación

Conservaremos tus datos mientras tu cuenta o relación con GPUL permanezca activa y, después, durante los plazos necesarios para atender responsabilidades legales. Cuando finalicen, los datos serán eliminados o anonimizados.

Puedes iniciar el cierre de la cuenta desde los ajustes («Zona de peligro»). El servidor comprueba la acreditación canónica en el momento de la solicitud: sin acreditación, la cuenta se elimina por completo cuando es posible; después de la acreditación, se anonimiza de forma irreversible.

Si solicitas la anonimización mientras constas dentro del recinto, la solicitud se acepta como una salida pendiente: se detienen los servicios de participación y los datos de identidad y alimentación existentes solo se conservan durante la breve transición necesaria para que el personal registre la salida o finalice el plazo de recuperación; puedes cancelarla antes de que ocurra. Después, la anonimización irreversible revoca el acceso y elimina los identificadores directos, credenciales, entradas, datos de autenticación de Wallet, archivos y la información alimentaria. Se crea un nuevo registro aleatorio de participante anónimo sin tabla de consulta ni otra correspondencia con la identidad. Solo pueden permanecer las respuestas de solicitudes que un administrador autorizado haya marcado expresamente para auditoría anónima en la versión del formulario que utilizó la persona, junto con el tiempo verificado de presencia generado por las operaciones del evento. Las respuestas no marcadas y los identificadores directos se eliminan. Las combinaciones de datos anónimos pueden crear riesgo de reidentificación en grupos muy pequeños, por lo que GPUL debería agrupar u ocultar combinaciones poco frecuentes al publicar estadísticas. La anonimización impide emitir más adelante justificantes nominales de participación o documentación ECTS. [hackudc@gpul.org](mailto:hackudc@gpul.org) sigue disponible como canal secundario de privacidad y asistencia.

## 7. Cookies y almacenamiento local

hackOS utiliza una cookie de sesión propia, imprescindible para autenticarte y proteger tu cuenta. También guarda localmente preferencias como el idioma, el tema, el estado de la navegación y la confirmación de que has visto el aviso de cookies. No utilizamos estos mecanismos para publicidad comportamental ni para vender información sobre tu navegación.

## 8. Tus derechos

Puedes solicitar el acceso, rectificación, supresión, oposición, limitación o portabilidad de tus datos y retirar un consentimiento en cualquier momento. Escribe a [hackudc@gpul.org](mailto:hackudc@gpul.org) indicando tu solicitud. Podremos pedirte información razonable para verificar tu identidad.

Si consideras que el tratamiento infringe la normativa, puedes reclamar ante GPUL o ante la [Agencia Española de Protección de Datos](https://www.aepd.es/).

## 9. Seguridad

GPUL aplica medidas técnicas y organizativas proporcionadas al riesgo para proteger los datos frente a pérdida, alteración, acceso o divulgación no autorizados. Ningún sistema es completamente infalible; si detectas una incidencia, comunícala cuanto antes a nuestro correo de contacto.

## 10. Cambios y contacto

Esta política puede actualizarse para reflejar cambios legales, organizativos o técnicos. Publicaremos la versión vigente en esta página y comunicaremos los cambios relevantes por canales adicionales cuando corresponda.

Para cualquier consulta sobre privacidad, escribe a [hackudc@gpul.org](mailto:hackudc@gpul.org).`,
  },
  gl: {
    title: "Política de privacidade",
    description:
      "Aquí explicamos que datos trata GPUL a través de hackOS, para que os utiliza e como podes exercer os teus dereitos.",
    updatedAt: "27 de agosto de 2026",
    body: `## 1. Responsable do tratamento

Esta política aplícase unicamente á instancia de hackOS operada por GPUL. Unha instalación despregada por outra persoa ou entidade é unha instancia independente: o seu operador será responsable do tratamento e deberá facilitar a súa propia política de privacidade. GPUL non controla nin trata os datos almacenados en instancias de terceiros.

A Asociación Universitaria Grupo de Programadores y Usuarios de Linux (**GPUL**), con NIF G15659220 e domicilio na Facultade de Informática, Campus de Elviña S/N, 15071 A Coruña, é a responsable do tratamento dos teus datos persoais.

hackOS é o sistema oficial de operacións de GPUL para o evento HackUDC. A inscrición faise nunha plataforma web externa e non concede por si soa acceso a hackOS: o acceso habilítase para participantes aceptados e persoal autorizado que xestiona a acreditación, os servizos do evento e a participación. Esta política complementa, sen substituír, a [política de privacidade xeral do evento HackUDC, publicada por GPUL](https://hackudc.gpul.org/privacy), que describe o tratamento de datos do evento no seu conxunto.

Podes contactar con GPUL nese enderezo ou mediante [hackudc@gpul.org](mailto:hackudc@gpul.org) para calquera consulta relacionada coa privacidade.

## 2. Datos que tratamos

Segundo como utilices hackOS, poderemos tratar as seguintes categorías:

- **Conta e identificación:** nome, apelidos, correo electrónico, credenciais de acceso protexidas, idioma, imaxe de perfil e, cando sexa necesario para a acreditación, documento identificativo e código de acceso.
- **Solicitudes:** respostas a formularios, universidade, talla de camiseta, currículo ou xustificantes e outros datos que solicite a convocatoria. Cada formulario identificará que campos son obrigatorios.
- **Datos de saúde:** alerxias, intolerancias e outras necesidades dietéticas proporcionadas voluntariamente para organizar o catering.
- **Participación:** proxectos, equipos, retos, quendas, acreditacións, accesos, actividades, avaliacións e comunicacións do evento.
- **Datos técnicos e de seguridade:** enderezo IP, navegador, sesións, rexistros de actividade e datos necesarios para previr abusos e resolver incidencias.
- **Comunicacións:** mensaxes, solicitudes de soporte e preferencias de notificación.

Os datos proceden directamente de ti, de persoas autorizadas do teu equipo ou entidade e da actividade xerada ao utilizar hackOS.

Algúns formularios ou rexistros de proxectos poden pedirche que proporciones ligazóns a sitios web externos, como repositorios, demostracións ou portafolios. Eses sitios son independentes de hackOS e GPUL, teñen as súas propias políticas de privacidade e non están operados, vinculados nin afiliados con GPUL. Cando visites eses sitios ou lles envíes datos, aplicaranse as súas propias políticas e condicións.

## 3. Finalidades e bases xurídicas

- **Xestionar a túa conta, solicitude e participación:** execución da relación precontractual ou contractual derivada da túa inscrición e aceptación destes termos.
- **Xestionar procesos operativos:** acreditación, horarios, equipos, proxectos, avaliación, loxística e comunicacións; segundo o caso, por execución da relación de participación ou interese lexítimo de GPUL.
- **Xestionar datos de saúde:** o teu consentimento explícito. Podes retiralo, aínda que isto pode limitar a adaptación do catering ás túas necesidades.
- **Protexer hackOS e cumprir obrigas legais:** interese lexítimo de GPUL en manter a seguridade e o cumprimento das obrigas legais aplicables.
- **Enviar información sobre actividades similares:** consentimento cando sexa esixible ou interese lexítimo permitido pola normativa. Poderás opoñerte en calquera momento.
- **Publicar imaxes ou vídeos identificables:** consentimento explícito ou a base xurídica que se indique ao realizar a captación.

## 4. Destinatarios

GPUL configura e controla a autenticación, as bases de datos e o almacenamento compatible con S3. Estes servizos execútanse en infraestrutura privada asignada a GPUL e baixo o seu control lóxico, aínda que a operación da infraestrutura física subxacente non teña que realizala directamente a Asociación. Os servidores que aloxan as contas, solicitudes, bases de datos e ficheiros están situados no Espazo Económico Europeo.

Poderemos comunicar datos, limitados ao necesario, a:

- Administracións públicas, xulgados e forzas de seguridade cando exista unha obriga legal.
- **Expo:** se activas as notificacións push, enviaremos a Expo Push Service o token de notificacións do teu dispositivo, o título e texto da notificación e os datos técnicos necesarios para dirixila dentro da aplicación. Expo actúa como encargado do tratamento para entregar a mensaxe ao servizo de notificacións do sistema operativo do teu dispositivo.
- Persoas patrocinadoras ou avaliadoras cando sexa necesario para xestionar un proceso no que participes ou cando autorizases expresamente compartir a túa candidatura ou currículo.
- Asesores e auditores cando sexa necesario para cumprir obrigas legais.

GPUL non vende os teus datos persoais.

## 5. Transferencias internacionais

O uso de Expo Push Service e dos servizos de notificacións do sistema operativo pode implicar o tratamento fóra do Espazo Económico Europeo dos datos necesarios para entregar unha notificación. GPUL aplicará as garantías esixidas pola normativa, como unha decisión de adecuación ou cláusulas contractuais tipo, cando resulten necesarias.

A información principal de hackOS —incluídas as contas, solicitudes, bases de datos e ficheiros— permanece en infraestrutura privada situada no Espazo Económico Europeo e baixo o control lóxico de GPUL. Esta información non se transfire a Expo.

## 6. Conservación

Conservaremos os teus datos mentres a túa conta ou relación con GPUL permaneza activa e, despois, durante os prazos necesarios para atender responsabilidades legais. Cando finalicen, os datos serán eliminados ou anonimizados.

Podes iniciar o peche da conta desde os axustes («Zona de perigo»). O servidor comproba a acreditación canónica no momento da solicitude: sen acreditación, a conta elimínase por completo cando é posible; despois da acreditación, anonimízase de forma irreversible.

Se solicitas a anonimización mentres constas dentro do recinto, a solicitude acéptase como unha saída pendente: detéñense os servizos de participación e os datos de identidade e alimentación existentes só se conservan durante a breve transición necesaria para que o persoal rexistre a saída ou remate o prazo de recuperación; podes cancelala antes de que ocorra. Despois, a anonimización irreversible revoga o acceso e elimina os identificadores directos, credenciais, entradas, datos de autenticación de Wallet, ficheiros e a información alimentaria. Créase un novo rexistro aleatorio de participante anónimo sen táboa de consulta nin outra correspondencia coa identidade. Só poden permanecer as respostas de solicitudes que unha persoa administradora autorizada marcase expresamente para auditoría anónima na versión do formulario utilizada pola persoa participante, xunto co tempo verificado de presenza xerado polas operacións do evento. As respostas non marcadas e os identificadores directos elimínanse. As combinacións de datos anónimos poden crear risco de reidentificación en grupos moi pequenos, polo que GPUL debería agrupar ou ocultar combinacións pouco frecuentes ao publicar estatísticas. A anonimización impide emitir máis adiante xustificantes nominais de participación ou documentación ECTS. [hackudc@gpul.org](mailto:hackudc@gpul.org) segue dispoñible como canle secundaria de privacidade e asistencia.

## 7. Cookies e almacenamento local

hackOS utiliza unha cookie de sesión propia, imprescindible para autenticarte e protexer a túa conta. Tamén garda localmente preferencias como o idioma, o tema, o estado da navegación e a confirmación de que viches o aviso de cookies. Non utilizamos estes mecanismos para publicidade comportamental nin para vender información sobre a túa navegación.

## 8. Os teus dereitos

Podes solicitar o acceso, rectificación, supresión, oposición, limitación ou portabilidade dos teus datos e retirar un consentimento en calquera momento. Escribe a [hackudc@gpul.org](mailto:hackudc@gpul.org) indicando a túa solicitude. Poderemos pedirche información razoable para verificar a túa identidade.

Se consideras que o tratamento infrinxe a normativa, podes reclamar ante GPUL ou ante a [Axencia Española de Protección de Datos](https://www.aepd.es/).

## 9. Seguridade

GPUL aplica medidas técnicas e organizativas proporcionadas ao risco para protexer os datos fronte á perda, alteración, acceso ou divulgación non autorizados. Ningún sistema é completamente infalible; se detectas unha incidencia, comunícaa canto antes ao noso correo de contacto.

## 10. Cambios e contacto

Esta política pode actualizarse para reflectir cambios legais, organizativos ou técnicos. Publicaremos a versión vixente nesta páxina e comunicaremos os cambios relevantes por canles adicionais cando corresponda.

Para calquera consulta sobre privacidade, escribe a [hackudc@gpul.org](mailto:hackudc@gpul.org).`,
  },
  en: {
    title: "Privacy policy",
    description:
      "This policy explains what data GPUL processes through hackOS, why it is used and how you can exercise your rights.",
    updatedAt: "27 August 2026",
    body: `## 1. Data controller

This policy applies only to the hackOS instance operated by GPUL. An installation deployed by another person or organisation is an independent instance: its operator is the data controller and must provide its own privacy policy. GPUL does not control or process data stored in third-party instances.

The Asociación Universitaria Grupo de Programadores y Usuarios de Linux (**GPUL**), tax ID G15659220, with its address at Facultad de Informática, Campus de Elviña S/N, 15071 A Coruña, Spain, is the controller of your personal data.

hackOS is GPUL's official operations system for the HackUDC event. Registration takes place on an external web platform and does not by itself grant hackOS access: access is enabled for accepted participants and authorised staff who manage accreditation, event services and participation. This policy complements, and does not replace, [the general privacy policy for the HackUDC event, published by GPUL](https://hackudc.gpul.org/privacy), which describes data processing for the event as a whole.

You may contact GPUL at that address or at [hackudc@gpul.org](mailto:hackudc@gpul.org) with any privacy-related query.

## 2. Data we process

Depending on how you use hackOS, we may process the following categories:

- **Account and identification:** first and last name, email address, protected access credentials, language, profile image and, where needed for accreditation, an identity document and access code.
- **Applications:** form responses, university, T-shirt size, CV or supporting documents and other information requested by a call for applications. Each form identifies its required fields.
- **Health data:** allergies, intolerances and other dietary requirements you voluntarily provide for catering purposes.
- **Participation:** projects, teams, challenges, turns, accreditation, access, activities, assessments and event communications.
- **Technical and security data:** IP address, browser, sessions, activity logs and information needed to prevent abuse and resolve incidents.
- **Communications:** messages, support requests and notification preferences.

The data comes directly from you, authorised members of your team or organisation, and activity generated when you use hackOS.

Some forms or project records may ask you to provide links to external websites, such as repositories, demos or portfolios. Those sites are independent of hackOS and GPUL, have their own privacy policies, and are not operated by, connected to or affiliated with GPUL. Their own policies and terms apply when you visit them or send them data.

## 3. Purposes and legal bases

- **Managing your account, application and participation:** performance of the pre-contractual or contractual relationship arising from your registration and acceptance of these terms.
- **Managing operational processes:** accreditation, schedules, teams, projects, assessment, logistics and communications; depending on the circumstances, performance of the participation relationship or GPUL's legitimate interests.
- **Managing health data:** your explicit consent. You may withdraw it, although this may limit our ability to adapt catering to your needs.
- **Protecting hackOS and complying with legal obligations:** GPUL's legitimate interest in maintaining security and compliance with applicable legal obligations.
- **Sending information about similar activities:** consent where required or legitimate interests where permitted by law. You may object at any time.
- **Publishing identifiable images or videos:** explicit consent or the legal basis specified when the material is captured.

## 4. Recipients

GPUL configures and controls authentication, databases and S3-compatible storage. These services run on private infrastructure assigned to GPUL and under its logical control, although the Association need not directly operate the underlying physical infrastructure. The servers hosting accounts, applications, databases and files are located in the European Economic Area.

We may disclose data, limited to what is necessary, to:

- Public authorities, courts and law-enforcement bodies where required by law.
- **Expo:** if you enable push notifications, we send Expo Push Service your device's push token, the notification title and text, and technical data needed to route it within the application. Expo acts as a processor to deliver the message to your device operating system's notification service.
- Sponsors or assessors where needed to manage a process in which you participate, or where you have expressly authorised us to share your application or CV.
- Advisers and auditors where needed to comply with legal obligations.

GPUL does not sell your personal data.

## 5. International transfers

Use of Expo Push Service and operating-system notification services may involve processing outside the European Economic Area of the data required to deliver a notification. GPUL will apply safeguards required by law, such as an adequacy decision or standard contractual clauses, where necessary.

Core hackOS information —including accounts, applications, databases and files— remains on private infrastructure located in the European Economic Area and under GPUL's logical control. This information is not transferred to Expo.

## 6. Retention

We retain your data while your account or relationship with GPUL remains active and afterwards for the periods necessary to address legal liabilities. Once those periods end, the data is deleted or anonymised.

You can start account closure from the account settings ("Danger zone"). The server checks canonical accreditation at the time of the request: without accreditation, the account is fully deleted where possible; after accreditation, it is irreversibly anonymised instead.

If you request anonymisation while you are recorded as inside the venue, the request is accepted as a pending exit: participation services stop, and existing identity and dietary data are retained only for the short transition needed for staff to record your exit or for the recovery deadline to expire; you can cancel before that happens. The subsequent irreversible anonymisation revokes access and removes direct identifiers, credentials, tickets, wallet authentication data, files and dietary information. It creates a new random anonymous participant record with no lookup table or other identity mapping. Only application answers that an authorised form administrator explicitly marked for anonymous audit in the form version used by that participant may remain, together with verified venue-presence time generated by event operations. Unmarked answers and direct identifiers are removed. Combinations of anonymous data may create re-identification risk in a very small cohort, so GPUL should aggregate or suppress unusual combinations when publishing statistics. Anonymisation cannot later support named participation proof or ECTS documentation. A mailto link to [hackudc@gpul.org](mailto:hackudc@gpul.org) remains available as a secondary privacy/support channel.

## 7. Cookies and local storage

hackOS uses its own session cookie, which is essential to authenticate you and protect your account. It also stores preferences locally, including language, theme, navigation state and confirmation that you have seen the cookie notice. We do not use these mechanisms for behavioural advertising or to sell information about your browsing.

## 8. Your rights

You may request access to, rectification or erasure of your data, object to or restrict processing, request data portability, and withdraw consent at any time. Email [hackudc@gpul.org](mailto:hackudc@gpul.org) with your request. We may ask for reasonable information to verify your identity.

If you believe the processing breaches the law, you may complain to GPUL or the [Spanish Data Protection Agency](https://www.aepd.es/).

## 9. Security

GPUL applies technical and organisational measures proportionate to the risk to protect data against loss, alteration, unauthorised access or disclosure. No system is completely infallible; if you identify an incident, please report it promptly to our contact email.

## 10. Changes and contact

This policy may be updated to reflect legal, organisational or technical changes. We will publish the current version on this page and communicate material changes through additional channels where appropriate.

For any privacy query, email [hackudc@gpul.org](mailto:hackudc@gpul.org).`,
  },
};

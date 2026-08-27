import type { LegalDocumentCopy } from "@/components/legal/localized-legal-document";
import type { Language } from "@/lib/types";

export const termsCopy: Record<Language, LegalDocumentCopy> = {
  es: {
    title: "Términos y condiciones",
    description: "Estos términos regulan exclusivamente el acceso y uso de la plataforma hackOS.",
    updatedAt: "26 de agosto de 2026",
    body: `## 1. Objeto y aceptación

Estos términos y condiciones regulan el acceso y uso de **hackOS**, la plataforma que GPUL utiliza para gestionar el registro, las solicitudes, las acreditaciones, las comunicaciones y otros procesos operativos de HackUDC.

La inscripción en HackUDC se realiza en una plataforma web externa. hackOS es el sistema oficial de operaciones que GPUL proporciona después de la aceptación para participantes y personal autorizado: permite gestionar el acceso a la aplicación, la acreditación, los servicios del evento y la participación, pero registrarse externamente no concede por sí solo acceso a hackOS. Aceptar estos términos y la política de privacidad es necesario para utilizar esta instancia; las condiciones generales del evento siguen regulando la inscripción y la participación.

Estos términos son adicionales a los [términos y condiciones generales de HackUDC](https://hackudc.gpul.org/terms) y no los sustituyen: ambos aplican de forma conjunta. Las bases o normas de cualquier actividad gestionada mediante hackOS son independientes de estos términos.

## 2. Software open source e instancias independientes

hackOS es un proyecto de software open source. Su código y documentación pueden utilizarse, modificarse y redistribuirse conforme a la licencia publicada junto al código fuente. Estos términos regulan el uso de esta instancia y no limitan los derechos concedidos por dicha licencia.

Cualquier persona o entidad puede desplegar y operar su propia instancia de hackOS. Cada instancia es un servicio independiente y su operador es responsable de administrarla, mantenerla, identificar sus condiciones de uso y cumplir las obligaciones legales que le correspondan. Quienes desarrollan hackOS no controlan ni responden de instancias operadas por terceros.

## 3. Operador de esta instancia

Esta instancia concreta de hackOS está operada por la siguiente entidad (en adelante, el «Operador»):

- Entidad: Asociación Universitaria Grupo de Programadores y Usuarios de Linux (GPUL).
- NIF: G15659220.
- Domicilio: Facultad de Informática, Campus de Elviña S/N, 15071 A Coruña.
- Contacto: [hackudc@gpul.org](mailto:hackudc@gpul.org).

## 4. Registro y cuenta

- Debes proporcionar información veraz, actual y completa.
- Debes custodiar tus credenciales y comunicar cualquier acceso no autorizado a tu cuenta.
- No puedes suplantar a otra persona, crear cuentas fraudulentas ni ceder tu cuenta.
- Eres responsable de las acciones realizadas desde tu cuenta, salvo que se deban a una incidencia imputable al Operador.
- Algunas funciones requieren que verifiques tu correo o que una persona administradora te asigne permisos específicos.

## 5. Funciones y permisos

Las funciones disponibles dependen del tipo de cuenta y de los permisos asignados. hackOS puede permitir, entre otras acciones, presentar formularios, recibir comunicaciones, gestionar perfiles, administrar contenidos o consultar información operativa.

Los permisos de administración, revisión o acceso a datos son personales y deben utilizarse únicamente para las tareas autorizadas. No conceden ningún derecho sobre la información a la que permiten acceder.

## 6. Uso aceptable

Al utilizar hackOS, te comprometes a no:

- Acceder o intentar acceder a cuentas, datos o funciones sin autorización.
- Introducir malware, interferir con el servicio, eludir medidas de seguridad o realizar pruebas de carga o vulnerabilidad sin permiso previo.
- Utilizar la plataforma para acosar, discriminar, amenazar o perjudicar a terceros.
- Publicar contenido ilícito o que infrinja derechos de terceros.
- Extraer datos de forma automatizada, masiva o incompatible con la finalidad de la plataforma.
- Utilizar hackOS con fines fraudulentos o contrarios a la legislación aplicable.

## 7. Contenido y datos aportados

Conservas los derechos que te correspondan sobre la información y los archivos que aportes. Declaras que tienes autorización para introducirlos en hackOS y que su uso no vulnera la ley ni derechos de terceros.

Concedes al Operador una autorización limitada, no exclusiva y durante el tiempo necesario para alojar, reproducir y tratar ese contenido únicamente con el fin de prestar, proteger y mantener esta instancia. El tratamiento de datos personales se describe en la [política de privacidad](/privacy).

## 8. Licencia del software y otros derechos

El código y la documentación de hackOS se ofrecen conforme a la licencia open source incluida en el repositorio del proyecto. En caso de conflicto entre estos términos de uso y esa licencia respecto al código, prevalecerá la licencia open source.

Las marcas, logotipos, contenidos de esta instancia y otros elementos que no formen parte del código distribuido conservan la titularidad y condiciones que les correspondan. La licencia de hackOS tampoco sustituye las licencias de sus dependencias.

## 9. Servicios de terceros

El Operador configura y controla los servicios principales de esta instancia, incluyendo la autenticación, las bases de datos y el almacenamiento de archivos compatible con S3. Estos servicios se ejecutan en infraestructura privada asignada al Operador y bajo su control lógico, aunque la operación de la infraestructura física subyacente no tenga que realizarse directamente por él. Los servidores utilizados para alojar la información principal de esta instancia están ubicados en el Espacio Económico Europeo.

Si activas las notificaciones push en la aplicación móvil, su entrega se realiza mediante Expo Push Service. La disponibilidad y entrega de esas notificaciones dependen de Expo y, en última instancia, del servicio de notificaciones del sistema operativo del dispositivo. Este servicio externo no interviene en la autenticación ni aloja la información principal de tu cuenta. Encontrarás más información en la política de privacidad de esta instancia.

## 10. Disponibilidad y cambios del servicio

El Operador procura mantener esta instancia disponible y segura, pero no garantiza que el servicio sea ininterrumpido o esté libre de errores. Podrá realizar tareas de mantenimiento, corregir incidencias, modificar funciones o retirar partes de la plataforma por motivos técnicos, legales, organizativos o de seguridad.

Cuando un cambio afecte de forma relevante al uso ordinario de hackOS, intentaremos comunicarlo con una antelación razonable, salvo que una situación urgente impida hacerlo.

## 11. Suspensión y baja

El Operador puede limitar o suspender una cuenta cuando exista un incumplimiento de estos términos, un riesgo para la seguridad, una obligación legal o un uso que perjudique a la plataforma o a otras personas. Siempre que sea posible, se informará del motivo y de las medidas para resolver la situación.

Puedes iniciar el cierre de tu cuenta desde «Ajustes → Zona de peligro»; el servidor explicará si corresponde la eliminación completa o la anonimización irreversible según la acreditación canónica del evento. Si todavía constas dentro del recinto, una solicitud aceptada se completará cuando el personal registre tu salida. También puedes ejercer tus derechos sobre los datos personales mediante los canales indicados en la política de privacidad. Determinada información podrá conservarse de forma anónima cuando sea necesaria para la auditoría de participación.

## 12. Responsabilidad

En la medida permitida por la ley, el Operador no será responsable de pérdidas indirectas, fallos de dispositivos o conexiones de la persona usuaria, usos contrarios a estos términos ni interrupciones causadas por terceros o circunstancias fuera de su control razonable. Las garantías aplicables al código fuente se determinan por su licencia open source.

Nada en estos términos limita los derechos irrenunciables de las personas usuarias ni la responsabilidad que legalmente no pueda excluirse.

## 13. Modificación de estos términos

El Operador podrá actualizar estos términos para reflejar cambios legales, técnicos o funcionales. La versión vigente estará disponible en esta página. Los cambios relevantes se comunicarán mediante hackOS, correo electrónico u otro canal adecuado antes de que resulten aplicables, cuando corresponda.

## 14. Legislación y jurisdicción

Estos términos se rigen por la legislación española. Cualquier controversia se someterá a los juzgados y tribunales que resulten competentes conforme a la normativa aplicable y, cuando legalmente proceda, a los de A Coruña.

## 15. Contacto

Para consultas sobre estos términos, escribe a [hackudc@gpul.org](mailto:hackudc@gpul.org).`,
  },
  gl: {
    title: "Termos e condicións",
    description: "Estes termos regulan exclusivamente o acceso e uso da plataforma hackOS.",
    updatedAt: "26 de agosto de 2026",
    body: `## 1. Obxecto e aceptación

Estes termos e condicións regulan o acceso e uso de **hackOS**, a plataforma que GPUL utiliza para xestionar o rexistro, as solicitudes, as acreditacións, as comunicacións e outros procesos operativos de HackUDC.

A inscrición en HackUDC faise nunha plataforma web externa. hackOS é o sistema oficial de operacións que GPUL proporciona despois da aceptación para participantes e persoal autorizado: permite xestionar o acceso á aplicación, a acreditación, os servizos do evento e a participación, pero rexistrarse externamente non concede por si só acceso a hackOS. Aceptar estes termos e a política de privacidade é necesario para utilizar esta instancia; as condicións xerais do evento seguen regulando a inscrición e a participación.

Estes termos son adicionais aos [termos e condicións xerais de HackUDC](https://hackudc.gpul.org/terms) e non os substitúen: ambos os dous aplícanse de forma conxunta. As bases ou normas de calquera actividade xestionada mediante hackOS son independentes destes termos.

## 2. Software open source e instancias independentes

hackOS é un proxecto de software open source. O seu código e documentación poden utilizarse, modificarse e redistribuírse conforme á licenza publicada xunto ao código fonte. Estes termos regulan o uso desta instancia e non limitan os dereitos concedidos por esa licenza.

Calquera persoa ou entidade pode despregar e operar a súa propia instancia de hackOS. Cada instancia é un servizo independente e o seu operador é responsable de administrala, mantela, identificar as súas condicións de uso e cumprir as obrigas legais que lle correspondan. Quen desenvolve hackOS non controla nin responde das instancias operadas por terceiros.

## 3. Operador desta instancia

Esta instancia concreta de hackOS está operada pola seguinte entidade (en diante, o «Operador»):

- Entidade: Asociación Universitaria Grupo de Programadores y Usuarios de Linux (GPUL).
- NIF: G15659220.
- Domicilio: Facultade de Informática, Campus de Elviña S/N, 15071 A Coruña.
- Contacto: [hackudc@gpul.org](mailto:hackudc@gpul.org).

## 4. Rexistro e conta

- Debes proporcionar información veraz, actual e completa.
- Debes custodiar as túas credenciais e comunicar calquera acceso non autorizado á túa conta.
- Non podes suplantar outra persoa, crear contas fraudulentas nin ceder a túa conta.
- Es responsable das accións realizadas desde a túa conta, agás que se deban a unha incidencia imputable ao Operador.
- Algunhas funcións requiren que verifiques o teu correo ou que unha persoa administradora che asigne permisos específicos.

## 5. Funcións e permisos

As funcións dispoñibles dependen do tipo de conta e dos permisos asignados. hackOS pode permitir, entre outras accións, presentar formularios, recibir comunicacións, xestionar perfís, administrar contidos ou consultar información operativa.

Os permisos de administración, revisión ou acceso a datos son persoais e deben utilizarse unicamente para as tarefas autorizadas. Non conceden ningún dereito sobre a información á que permiten acceder.

## 6. Uso aceptable

Ao utilizar hackOS, comprométeste a non:

- Acceder ou tentar acceder a contas, datos ou funcións sen autorización.
- Introducir malware, interferir co servizo, eludir medidas de seguridade ou realizar probas de carga ou vulnerabilidade sen permiso previo.
- Utilizar a plataforma para acosar, discriminar, ameazar ou prexudicar terceiros.
- Publicar contido ilícito ou que infrinxa dereitos de terceiros.
- Extraer datos de forma automatizada, masiva ou incompatible coa finalidade da plataforma.
- Utilizar hackOS con fins fraudulentos ou contrarios á lexislación aplicable.

## 7. Contido e datos achegados

Conservas os dereitos que che correspondan sobre a información e os ficheiros que achegues. Declaras que tes autorización para introducilos en hackOS e que o seu uso non vulnera a lei nin dereitos de terceiros.

Concedes ao Operador unha autorización limitada, non exclusiva e durante o tempo necesario para aloxar, reproducir e tratar ese contido unicamente co fin de prestar, protexer e manter esta instancia. O tratamento de datos persoais descríbese na [política de privacidade](/privacy).

## 8. Licenza do software e outros dereitos

O código e a documentación de hackOS ofrécense conforme á licenza open source incluída no repositorio do proxecto. En caso de conflito entre estes termos de uso e esa licenza respecto ao código, prevalecerá a licenza open source.

As marcas, logotipos, contidos desta instancia e outros elementos que non formen parte do código distribuído conservan a titularidade e condicións que lles correspondan. A licenza de hackOS tampouco substitúe as licenzas das súas dependencias.

## 9. Servizos de terceiros

O Operador configura e controla os servizos principais desta instancia, incluíndo a autenticación, as bases de datos e o almacenamento de ficheiros compatible con S3. Estes servizos execútanse en infraestrutura privada asignada ao Operador e baixo o seu control lóxico, aínda que a operación da infraestrutura física subxacente non teña que realizala directamente. Os servidores utilizados para aloxar a información principal desta instancia están situados no Espazo Económico Europeo.

Se activas as notificacións push na aplicación móbil, a súa entrega realízase mediante Expo Push Service. A dispoñibilidade e entrega desas notificacións dependen de Expo e, en última instancia, do servizo de notificacións do sistema operativo do dispositivo. Este servizo externo non intervén na autenticación nin aloxa a información principal da túa conta. Atoparás máis información na política de privacidade desta instancia.

## 10. Dispoñibilidade e cambios do servizo

O Operador procura manter esta instancia dispoñible e segura, pero non garante que o servizo sexa ininterrompido ou estea libre de erros. Poderá realizar tarefas de mantemento, corrixir incidencias, modificar funcións ou retirar partes da plataforma por motivos técnicos, legais, organizativos ou de seguridade.

Cando un cambio afecte de forma relevante o uso ordinario de hackOS, tentaremos comunicalo cunha antelación razoable, agás que unha situación urxente impida facelo.

## 11. Suspensión e baixa

O Operador pode limitar ou suspender unha conta cando exista un incumprimento destes termos, un risco para a seguridade, unha obriga legal ou un uso que prexudique a plataforma ou outras persoas. Sempre que sexa posible, informarase do motivo e das medidas para resolver a situación.

Podes iniciar o peche da túa conta desde «Axustes → Zona de perigo»; o servidor explicará se corresponde a eliminación completa ou a anonimización irreversible segundo a acreditación canónica do evento. Se aínda constas dentro do recinto, unha solicitude aceptada completarase cando o persoal rexistre a túa saída. Tamén podes exercer os teus dereitos sobre os datos persoais mediante as canles indicadas na política de privacidade. Determinada información poderá conservarse de forma anónima cando sexa necesaria para a auditoría da participación.

## 12. Responsabilidade

Na medida permitida pola lei, o Operador non será responsable de perdas indirectas, fallos de dispositivos ou conexións da persoa usuaria, usos contrarios a estes termos nin interrupcións causadas por terceiros ou circunstancias fóra do seu control razoable. As garantías aplicables ao código fonte determínanse pola súa licenza open source.

Nada nestes termos limita os dereitos irrenunciables das persoas usuarias nin a responsabilidade que legalmente non poida excluírse.

## 13. Modificación destes termos

O Operador poderá actualizar estes termos para reflectir cambios legais, técnicos ou funcionais. A versión vixente estará dispoñible nesta páxina. Os cambios relevantes comunicaranse mediante hackOS, correo electrónico ou outra canle adecuada antes de que resulten aplicables, cando corresponda.

## 14. Lexislación e xurisdición

Estes termos réxense pola lexislación española. Calquera controversia someterase aos xulgados e tribunais que resulten competentes conforme á normativa aplicable e, cando legalmente proceda, aos da Coruña.

## 15. Contacto

Para consultas sobre estes termos, escribe a [hackudc@gpul.org](mailto:hackudc@gpul.org).`,
  },
  en: {
    title: "Terms and conditions",
    description: "These terms exclusively govern access to and use of the hackOS platform.",
    updatedAt: "26 August 2026",
    body: `## 1. Purpose and acceptance

These terms and conditions govern access to and use of **hackOS**, the platform GPUL uses to manage registration, applications, accreditation, communications and other operational processes for HackUDC.

Registration for HackUDC takes place on an external web platform. hackOS is the official operations system GPUL provides after acceptance to participants and authorised staff: it manages application access, accreditation, event services and participation, but external registration does not by itself grant hackOS access. Accepting these terms and the privacy policy is necessary to use this instance; the event's general terms continue to govern registration and participation.

These terms are additional to, and do not replace, [HackUDC's general terms and conditions](https://hackudc.gpul.org/terms); both apply together. The rules or conditions of any activity managed through hackOS are separate from these terms.

## 2. Open-source software and independent instances

hackOS is an open-source software project. Its code and documentation may be used, modified and redistributed under the licence published with the source code. These terms govern the use of this instance and do not limit the rights granted by that licence.

Any person or organisation may deploy and operate its own hackOS instance. Each instance is an independent service, and its operator is responsible for administering and maintaining it, identifying its terms of use and complying with its legal obligations. The hackOS developers do not control or accept responsibility for instances operated by third parties.

## 3. Operator of this instance

This hackOS instance is operated by the following organisation (the “Operator”):

- Organisation: Asociación Universitaria Grupo de Programadores y Usuarios de Linux (GPUL).
- Tax ID: G15659220.
- Address: Facultad de Informática, Campus de Elviña S/N, 15071 A Coruña, Spain.
- Contact: [hackudc@gpul.org](mailto:hackudc@gpul.org).

## 4. Registration and accounts

- You must provide accurate, current and complete information.
- You must keep your credentials secure and report any unauthorised access to your account.
- You may not impersonate another person, create fraudulent accounts or transfer your account.
- You are responsible for actions performed through your account unless they result from an incident attributable to the Operator.
- Some features require email verification or specific permissions assigned by an administrator.

## 5. Features and permissions

Available features depend on the account type and assigned permissions. hackOS may allow users to submit forms, receive communications, manage profiles, administer content or view operational information, among other actions.

Administrative, review and data-access permissions are personal and may only be used for authorised tasks. They grant no rights over the information they make accessible.

## 6. Acceptable use

When using hackOS, you agree not to:

- Access or attempt to access accounts, data or features without authorisation.
- Introduce malware, interfere with the service, bypass security measures or carry out load or vulnerability testing without prior permission.
- Use the platform to harass, discriminate against, threaten or harm others.
- Publish unlawful content or content that infringes third-party rights.
- Extract data automatically, in bulk or in a manner incompatible with the platform's purpose.
- Use hackOS for fraudulent purposes or in breach of applicable law.

## 7. Content and data you provide

You retain any rights you hold in the information and files you provide. You represent that you are authorised to upload them to hackOS and that their use does not breach the law or third-party rights.

You grant the Operator a limited, non-exclusive authorisation, for as long as necessary, to host, reproduce and process that content solely to provide, protect and maintain this instance. The processing of personal data is described in the [privacy policy](/privacy).

## 8. Software licence and other rights

The hackOS code and documentation are provided under the open-source licence included in the project repository. If these terms conflict with that licence in relation to the code, the open-source licence prevails.

Trade marks, logos, content belonging to this instance and other elements that are not part of the distributed code retain their respective ownership and terms. The hackOS licence also does not replace the licences of its dependencies.

## 9. Third-party services

The Operator configures and controls this instance's core services, including authentication, databases and S3-compatible file storage. These services run on private infrastructure assigned to the Operator and under its logical control, although the underlying physical infrastructure need not be operated directly by it. The servers hosting this instance's primary information are located in the European Economic Area.

If you enable push notifications in the mobile application, they are delivered through Expo Push Service. Their availability and delivery depend on Expo and, ultimately, on the device operating system's notification service. This external service is not involved in authentication and does not host your main account information. Further details are available in this instance's privacy policy.

## 10. Service availability and changes

The Operator seeks to keep this instance available and secure but does not guarantee uninterrupted or error-free service. It may perform maintenance, correct incidents, change features or remove parts of the platform for technical, legal, organisational or security reasons.

Where a change materially affects ordinary use of hackOS, we will try to give reasonable notice unless an urgent situation prevents us from doing so.

## 11. Suspension and account closure

The Operator may restrict or suspend an account where these terms have been breached, a security risk or legal obligation exists, or use of the account harms the platform or others. Where possible, the reason and steps needed to resolve the situation will be provided.

You can start account closure from "Settings → Danger zone"; the server will explain whether full deletion or irreversible anonymisation applies based on canonical event accreditation. If you are still recorded inside the venue, an accepted request completes after staff record your exit. You may also exercise your personal-data rights through the channels described in the privacy policy. Some information may be retained anonymously where needed for participation auditing.

## 12. Liability

To the extent permitted by law, the Operator is not liable for indirect losses, failures of user devices or connections, use contrary to these terms, or interruptions caused by third parties or circumstances beyond its reasonable control. Warranties applicable to the source code are determined by its open-source licence.

Nothing in these terms limits users' mandatory rights or any liability that cannot legally be excluded.

## 13. Changes to these terms

The Operator may update these terms to reflect legal, technical or functional changes. The current version will be available on this page. Where appropriate, material changes will be communicated through hackOS, email or another suitable channel before they take effect.

## 14. Governing law and jurisdiction

These terms are governed by Spanish law. Any dispute will be submitted to the courts with jurisdiction under applicable law and, where legally permitted, to the courts of A Coruña, Spain.

## 15. Contact

For questions about these terms, email [hackudc@gpul.org](mailto:hackudc@gpul.org).`,
  },
};

import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Términos y condiciones | hackOS",
  description: "Términos y condiciones de acceso y uso de la plataforma hackOS.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Términos y condiciones"
      description="Estos términos regulan exclusivamente el acceso y uso de la plataforma hackOS."
      updatedAt="14 de julio de 2026"
    >
      <LegalSection title="1. Objeto y aceptación">
        <p>
          Estos términos y condiciones regulan el acceso y uso de <strong>hackOS</strong>, una
          plataforma para gestionar cuentas, solicitudes, acreditaciones, comunicaciones y otros
          procesos operativos.
        </p>
        <p>
          Al crear una cuenta o utilizar hackOS, aceptas estos términos y la política de privacidad.
          Si no estás de acuerdo, no debes utilizar la plataforma. Las bases o normas de cualquier
          actividad gestionada mediante hackOS son independientes de estos términos.
        </p>
      </LegalSection>

      <LegalSection title="2. Software open source e instancias independientes">
        <p>
          hackOS es un proyecto de software open source. Su código y documentación pueden
          utilizarse, modificarse y redistribuirse conforme a la licencia publicada junto al código
          fuente. Estos términos regulan el uso de esta instancia y no limitan los derechos
          concedidos por dicha licencia.
        </p>
        <p>
          Cualquier persona o entidad puede desplegar y operar su propia instancia de hackOS. Cada
          instancia es un servicio independiente y su operador es responsable de administrarla,
          mantenerla, identificar sus condiciones de uso y cumplir las obligaciones legales que le
          correspondan. Quienes desarrollan hackOS no controlan ni responden de instancias operadas
          por terceros.
        </p>
      </LegalSection>

      <LegalSection title="3. Operador de esta instancia">
        <p>
          Esta instancia concreta de hackOS está operada por la siguiente entidad (en adelante, el
          «Operador»):
        </p>
        <ul>
          <li>
            Entidad: Asociación Universitaria Grupo de Programadores y Usuarios de Linux (GPUL).
          </li>
          <li>NIF: G15659220.</li>
          <li>Domicilio: Facultad de Informática, Campus de Elviña S/N, 15071 A Coruña.</li>
          <li>
            Contacto: <a href="mailto:hackudc@gpul.org">hackudc@gpul.org</a>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Registro y cuenta">
        <ul>
          <li>Debes proporcionar información veraz, actual y completa.</li>
          <li>
            Debes custodiar tus credenciales y comunicar cualquier acceso no autorizado a tu cuenta.
          </li>
          <li>
            No puedes suplantar a otra persona, crear cuentas fraudulentas ni ceder tu cuenta.
          </li>
          <li>
            Eres responsable de las acciones realizadas desde tu cuenta, salvo que se deban a una
            incidencia imputable al Operador.
          </li>
          <li>
            Algunas funciones requieren que verifiques tu correo o que una persona administradora te
            asigne permisos específicos.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Funciones y permisos">
        <p>
          Las funciones disponibles dependen del tipo de cuenta y de los permisos asignados. hackOS
          puede permitir, entre otras acciones, presentar formularios, recibir comunicaciones,
          gestionar perfiles, administrar contenidos o consultar información operativa.
        </p>
        <p>
          Los permisos de administración, revisión o acceso a datos son personales y deben
          utilizarse únicamente para las tareas autorizadas. No conceden ningún derecho sobre la
          información a la que permiten acceder.
        </p>
      </LegalSection>

      <LegalSection title="6. Uso aceptable">
        <p>Al utilizar hackOS, te comprometes a no:</p>
        <ul>
          <li>Acceder o intentar acceder a cuentas, datos o funciones sin autorización.</li>
          <li>
            Introducir malware, interferir con el servicio, eludir medidas de seguridad o realizar
            pruebas de carga o vulnerabilidad sin permiso previo.
          </li>
          <li>
            Utilizar la plataforma para acosar, discriminar, amenazar o perjudicar a terceros.
          </li>
          <li>Publicar contenido ilícito o que infrinja derechos de terceros.</li>
          <li>
            Extraer datos de forma automatizada, masiva o incompatible con la finalidad de la
            plataforma.
          </li>
          <li>Utilizar hackOS con fines fraudulentos o contrarios a la legislación aplicable.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Contenido y datos aportados">
        <p>
          Conservas los derechos que te correspondan sobre la información y los archivos que
          aportes. Declaras que tienes autorización para introducirlos en hackOS y que su uso no
          vulnera la ley ni derechos de terceros.
        </p>
        <p>
          Concedes al Operador una autorización limitada, no exclusiva y durante el tiempo necesario
          para alojar, reproducir y tratar ese contenido únicamente con el fin de prestar, proteger
          y mantener esta instancia. El tratamiento de datos personales se describe en la{" "}
          <a href="/privacy">política de privacidad</a>.
        </p>
      </LegalSection>

      <LegalSection title="8. Licencia del software y otros derechos">
        <p>
          El código y la documentación de hackOS se ofrecen conforme a la licencia open source
          incluida en el repositorio del proyecto. En caso de conflicto entre estos términos de uso
          y esa licencia respecto al código, prevalecerá la licencia open source.
        </p>
        <p>
          Las marcas, logotipos, contenidos de esta instancia y otros elementos que no formen parte
          del código distribuido conservan la titularidad y condiciones que les correspondan. La
          licencia de hackOS tampoco sustituye las licencias de sus dependencias.
        </p>
      </LegalSection>

      <LegalSection title="9. Servicios de terceros">
        <p>
          El Operador configura y controla los servicios principales de esta instancia, incluyendo
          la autenticación, las bases de datos y el almacenamiento de archivos compatible con S3.
          Estos servicios se ejecutan en infraestructura privada asignada al Operador y bajo su
          control lógico, aunque la operación de la infraestructura física subyacente no tenga que
          realizarse directamente por él. Los servidores utilizados para alojar la información
          principal de esta instancia están ubicados en el Espacio Económico Europeo.
        </p>
        <p>
          Si activas las notificaciones push en la aplicación móvil, su entrega se realiza mediante
          Expo Push Service. La disponibilidad y entrega de esas notificaciones dependen de Expo y,
          en última instancia, del servicio de notificaciones del sistema operativo del dispositivo.
          Este servicio externo no interviene en la autenticación ni aloja la información principal
          de tu cuenta. Encontrarás más información en la política de privacidad de esta instancia.
        </p>
      </LegalSection>

      <LegalSection title="10. Disponibilidad y cambios del servicio">
        <p>
          El Operador procura mantener esta instancia disponible y segura, pero no garantiza que el
          servicio sea ininterrumpido o esté libre de errores. Podrá realizar tareas de
          mantenimiento, corregir incidencias, modificar funciones o retirar partes de la plataforma
          por motivos técnicos, legales, organizativos o de seguridad.
        </p>
        <p>
          Cuando un cambio afecte de forma relevante al uso ordinario de hackOS, intentaremos
          comunicarlo con una antelación razonable, salvo que una situación urgente impida hacerlo.
        </p>
      </LegalSection>

      <LegalSection title="11. Suspensión y baja">
        <p>
          El Operador puede limitar o suspender una cuenta cuando exista un incumplimiento de estos
          términos, un riesgo para la seguridad, una obligación legal o un uso que perjudique a la
          plataforma o a otras personas. Siempre que sea posible, se informará del motivo y de las
          medidas para resolver la situación.
        </p>
        <p>
          Puedes solicitar la baja de tu cuenta y ejercer tus derechos sobre los datos personales
          mediante los canales indicados en la política de privacidad. Determinada información podrá
          conservarse durante los plazos legalmente exigibles.
        </p>
      </LegalSection>

      <LegalSection title="12. Responsabilidad">
        <p>
          En la medida permitida por la ley, el Operador no será responsable de pérdidas indirectas,
          fallos de dispositivos o conexiones de la persona usuaria, usos contrarios a estos
          términos ni interrupciones causadas por terceros o circunstancias fuera de su control
          razonable. Las garantías aplicables al código fuente se determinan por su licencia open
          source.
        </p>
        <p>
          Nada en estos términos limita los derechos irrenunciables de las personas usuarias ni la
          responsabilidad que legalmente no pueda excluirse.
        </p>
      </LegalSection>

      <LegalSection title="13. Modificación de estos términos">
        <p>
          El Operador podrá actualizar estos términos para reflejar cambios legales, técnicos o
          funcionales. La versión vigente estará disponible en esta página. Los cambios relevantes
          se comunicarán mediante hackOS, correo electrónico u otro canal adecuado antes de que
          resulten aplicables, cuando corresponda.
        </p>
      </LegalSection>

      <LegalSection title="14. Legislación y jurisdicción">
        <p>
          Estos términos se rigen por la legislación española. Cualquier controversia se someterá a
          los juzgados y tribunales que resulten competentes conforme a la normativa aplicable y,
          cuando legalmente proceda, a los de A Coruña.
        </p>
      </LegalSection>

      <LegalSection title="15. Contacto">
        <p>
          Para consultas sobre estos términos, escribe a{" "}
          <a href="mailto:hackudc@gpul.org">hackudc@gpul.org</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Política de privacidad | hackOS",
  description: "Información sobre el tratamiento de datos personales en hackOS.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de privacidad"
      description="Aquí explicamos qué datos trata GPUL a través de hackOS, para qué los utiliza y cómo puedes ejercer tus derechos."
      updatedAt="14 de julio de 2026"
    >
      <LegalSection title="1. Responsable del tratamiento">
        <p>
          Esta política se aplica únicamente a la instancia de hackOS operada por GPUL. Una
          instalación desplegada por otra persona o entidad es una instancia independiente: su
          operador será responsable del tratamiento y deberá facilitar su propia política de
          privacidad. GPUL no controla ni trata los datos almacenados en instancias de terceros.
        </p>
        <p>
          La Asociación Universitaria Grupo de Programadores y Usuarios de Linux (
          <strong>GPUL</strong>), con NIF G15659220 y domicilio en la Facultad de Informática,
          Campus de Elviña S/N, 15071 A Coruña, es la responsable del tratamiento de tus datos
          personales.
        </p>
        <p>
          Puedes contactar con GPUL en esa dirección o mediante{" "}
          <a href="mailto:hackudc@gpul.org">hackudc@gpul.org</a> para cualquier consulta relacionada
          con la privacidad.
        </p>
      </LegalSection>

      <LegalSection title="2. Datos que tratamos">
        <p>Según cómo utilices hackOS, podremos tratar las siguientes categorías:</p>
        <ul>
          <li>
            <strong>Cuenta e identificación:</strong> nombre, apellidos, correo electrónico,
            credenciales de acceso protegidas, teléfono, idioma, imagen de perfil y, cuando sea
            necesario para la acreditación, documento identificativo y código de acceso.
          </li>
          <li>
            <strong>Solicitudes:</strong> respuestas a formularios, universidad, talla de camiseta,
            currículum o justificantes y otros datos que solicite la convocatoria. Cada formulario
            identificará qué campos son obligatorios.
          </li>
          <li>
            <strong>Datos de salud:</strong> alergias, intolerancias y otras necesidades dietéticas
            proporcionadas voluntariamente para organizar el catering.
          </li>
          <li>
            <strong>Participación:</strong> proyectos, equipos, retos, turnos, acreditaciones,
            accesos, actividades, evaluaciones y comunicaciones del Evento.
          </li>
          <li>
            <strong>Datos técnicos y de seguridad:</strong> dirección IP, navegador, sesiones,
            registros de actividad y datos necesarios para prevenir abusos y resolver incidencias.
          </li>
          <li>
            <strong>Comunicaciones:</strong> mensajes, solicitudes de soporte y preferencias de
            notificación.
          </li>
        </ul>
        <p>
          Los datos proceden directamente de ti, de personas autorizadas de tu equipo o entidad y de
          la actividad generada al utilizar hackOS durante el Evento.
        </p>
      </LegalSection>

      <LegalSection title="3. Finalidades y bases jurídicas">
        <ul>
          <li>
            <strong>Gestionar tu cuenta, solicitud y participación:</strong> ejecución de la
            relación precontractual o contractual derivada de tu inscripción y aceptación de estos
            términos.
          </li>
          <li>
            <strong>Organizar el Evento:</strong> acreditación, horarios, equipos, proyectos,
            evaluación, premios, logística y comunicaciones operativas; según el caso, por ejecución
            de la relación de participación o interés legítimo de GPUL.
          </li>
          <li>
            <strong>Gestionar datos de salud:</strong> tu consentimiento explícito. Puedes
            retirarlo, aunque ello puede limitar la adaptación del catering a tus necesidades.
          </li>
          <li>
            <strong>Proteger hackOS y cumplir obligaciones legales:</strong> interés legítimo de
            GPUL en mantener la seguridad y cumplimiento de obligaciones legales aplicables.
          </li>
          <li>
            <strong>Enviar información sobre actividades similares:</strong> consentimiento cuando
            sea exigible o interés legítimo permitido por la normativa. Podrás oponerte en cualquier
            momento.
          </li>
          <li>
            <strong>Publicar imágenes o vídeos identificables:</strong> consentimiento explícito o
            la base jurídica que se indique al realizar la captación.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Destinatarios">
        <p>
          GPUL configura y controla la autenticación, las bases de datos y el almacenamiento
          compatible con S3. Estos servicios se ejecutan en infraestructura privada asignada a GPUL
          y bajo su control lógico, aunque la operación de la infraestructura física subyacente no
          tenga que realizarse directamente por la Asociación. Los servidores que alojan las
          cuentas, solicitudes, bases de datos y archivos están ubicados en el Espacio Económico
          Europeo.
        </p>
        <p>Podremos comunicar datos, limitados a lo necesario, a:</p>
        <ul>
          <li>
            Administraciones públicas, juzgados y fuerzas de seguridad cuando exista obligación
            legal.
          </li>
          <li>
            <strong>Expo:</strong> si activas las notificaciones push, enviaremos a Expo Push
            Service el token de notificaciones de tu dispositivo, el título y texto de la
            notificación y los datos técnicos necesarios para dirigirla dentro de la aplicación.
            Expo actúa como encargado del tratamiento para entregar el mensaje a Apple Push
            Notification Service o Firebase Cloud Messaging, según tu dispositivo.
          </li>
          <li>
            Patrocinadores o miembros del jurado cuando sea necesario para gestionar un reto,
            evaluar un proyecto o cuando hayas autorizado expresamente compartir tu candidatura o
            currículum.
          </li>
          <li>Asesores y auditores cuando sea necesario para cumplir obligaciones legales.</li>
        </ul>
        <p>GPUL no vende tus datos personales.</p>
      </LegalSection>

      <LegalSection title="5. Transferencias internacionales">
        <p>
          El uso de Expo Push Service y de los servicios de notificaciones de Apple o Google puede
          implicar el tratamiento de los datos necesarios para entregar una notificación fuera del
          Espacio Económico Europeo. GPUL aplicará las garantías exigidas por la normativa, como una
          decisión de adecuación o cláusulas contractuales tipo, cuando resulten necesarias.
        </p>
        <p>
          La información principal de hackOS —incluidas las cuentas, solicitudes, bases de datos y
          archivos— permanece en infraestructura privada ubicada en el Espacio Económico Europeo y
          bajo el control lógico de GPUL. Esta información no se transfiere a Expo.
        </p>
      </LegalSection>

      <LegalSection title="6. Conservación">
        <p>
          Conservaremos tus datos mientras tu cuenta o relación con GPUL permanezca activa y,
          después, durante los plazos necesarios para atender responsabilidades legales. Cuando
          finalicen, los datos serán eliminados o anonimizados.
        </p>
        <p>
          Las restricciones alimentarias se utilizan únicamente para planificar el catering y se
          eliminan cuando dejen de ser necesarias. Si no confirmas tu plaza o la rechazas, hackOS
          las elimina salvo que mantengas otra participación confirmada que todavía las requiera.
        </p>
      </LegalSection>

      <LegalSection title="7. Cookies y almacenamiento local">
        <p>
          hackOS utiliza una cookie de sesión propia, imprescindible para autenticarte y proteger tu
          cuenta. También guarda localmente preferencias como el idioma, el tema, el estado de la
          navegación y la confirmación de que has visto el aviso de cookies. No utilizamos estos
          mecanismos para publicidad comportamental ni para vender información sobre tu navegación.
        </p>
      </LegalSection>

      <LegalSection title="8. Tus derechos">
        <p>
          Puedes solicitar el acceso, rectificación, supresión, oposición, limitación o portabilidad
          de tus datos y retirar un consentimiento en cualquier momento. Escribe a{" "}
          <a href="mailto:hackudc@gpul.org">hackudc@gpul.org</a> indicando tu solicitud. Podremos
          pedirte información razonable para verificar tu identidad.
        </p>
        <p>
          Si consideras que el tratamiento infringe la normativa, puedes reclamar ante GPUL o ante
          la{" "}
          <a href="https://www.aepd.es/" rel="noreferrer" target="_blank">
            Agencia Española de Protección de Datos
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="9. Seguridad">
        <p>
          GPUL aplica medidas técnicas y organizativas proporcionadas al riesgo para proteger los
          datos frente a pérdida, alteración, acceso o divulgación no autorizados. Ningún sistema es
          completamente infalible; si detectas una incidencia, comunícala cuanto antes a nuestro
          correo de contacto.
        </p>
      </LegalSection>

      <LegalSection title="10. Cambios y contacto">
        <p>
          Esta política puede actualizarse para reflejar cambios legales, organizativos o técnicos.
          Publicaremos la versión vigente en esta página y comunicaremos los cambios relevantes por
          canales adicionales cuando corresponda.
        </p>
        <p>
          Para cualquier consulta sobre privacidad, escribe a{" "}
          <a href="mailto:hackudc@gpul.org">hackudc@gpul.org</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

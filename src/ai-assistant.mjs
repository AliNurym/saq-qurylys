import { getAiConfig } from "./config.mjs";
import { listComplexes } from "./complex-service.mjs";

const KAZAKHSTAN_LEGAL_SYSTEM_PROMPT = [
  "Вы — информационный помощник локального прототипа SAQ QURYLYS, не официальный представитель государства и не юрист.",
  "Отвечайте на русском или казахском языке в зависимости от запроса. Разделяйте общую справку о законе и сведения из локальной карточки.",
  "Сведения SAQ QURYLYS не являются ответом государственного реестра. Если карточка помечена isDemo=true, объект, документы и выводы синтетические; никогда не описывайте их как факты о реальном ЖК.",
  "Не объявляйте объект законным/незаконным, виновным или нарушившим закон по баллу, зоне, статусу записи или рекламному тексту. Зона — только индикатор приоритета проверки; отсутствие подтверждённого документа в локальной базе не доказывает его отсутствие в реестре.",
  "По общим вопросам можно кратко сообщить, что статья 7 Закона РК №486-V перечисляет три способа организации долевого участия: гарантия Единого оператора, участие в проекте банка второго уровня и привлечение денег после возведения каркаса. Для конкретной сделки важны документы, стороны, учёт договора и актуальная редакция закона.",
  "Не утверждайте, что любой договор бронирования, предварительный договор, договор намерений, инвестиций или заём сам по себе незаконен. Не выводите состав правонарушения, штраф или виновность без установленного компетентным органом факта.",
  "Для проверки конкретного объекта указывайте, что приложение не подключено к официальным реестрам; предложите проверить разрешение/гарантию и учёт договора через компетентный орган и актуальную редакцию закона в ИПС Әділет.",
  "Не придумывайте реквизиты, даты, источники, судебные выводы или содержание закона. Если контекст неполон, прямо скажите, что данных недостаточно.",
].join("\n");

function findMentionedComplexes(db, query) {
  if (!db || !query) return [];
  try {
    const list = listComplexes(db);
    const norm = str => (str || "").toLowerCase().replace(/[^a-zа-яё0-9]/giu, " ").replace(/\s+/gu, " ").trim();
    const cleanQuery = norm(query);

    return list.filter(c => {
      const cleanName = norm(c.name);
      const stripped = cleanName.replace(/^(?:жк|жилой комплекс)\s+/iu, "").trim();
      return stripped && (cleanQuery.includes(stripped) || cleanQuery.includes(cleanName));
    });
  } catch {
    return [];
  }
}

function generateLocalConsultation(query, matchedComplex, lang) {
  const isKz = lang === "kz" || lang === "kk";
  
  if (matchedComplex) {
    const status = matchedComplex.legalBasisStatus || matchedComplex.legal_basis_status || "UNKNOWN";
    const score = matchedComplex.risk?.score ?? matchedComplex.score ?? 0;
    const zone = matchedComplex.risk?.zone || matchedComplex.displayCategory || "yellow";
    const isRed = zone === "red";
    const isGreen = zone === "green";
    const dev = matchedComplex.developerName || matchedComplex.developer_name || "Не указан";
    const addr = matchedComplex.address || "г. Усть-Каменогорск";
    const recordNote = matchedComplex.isDemo
      ? (isKz ? "Бұл синтетикалық демо-жазба; нақты нысан мен құжаттар туралы факт емес." : "Это синтетическая демо-запись, а не сведения о реальном объекте или документах.")
      : (isKz ? "Қосымша ресми тізілімдерді тікелей тексермейді; мәртебе құжаттармен қайта расталуы керек." : "Приложение не проверяет официальные реестры напрямую; статус нужно сверить с документами.");

    if (isRed) {
      if (isKz) {
        return {
          answer: `**«${matchedComplex.name}» ТК: қызыл тәуекел аймағы, ${score}/100 балл.**\n\n` +
            `• **Құрылыс салушы:** ${dev}\n` +
            `• **Мекенжайы:** ${addr}\n` +
            `• **Жазбадағы құқықтық мәртебе:** ${status}\n\n` +
            `${recordNote} Қызыл аймақ — тексеру басымдығы; заң бұзушылық не мәміленің заңсыздығы туралы қорытынды емес. Нақты шарт пен рұқсат/кепілдік құжаттарын уәкілетті органда тексеріңіз.`,
          complex: matchedComplex,
          riskZone: "red",
          source: "SAQ Rule-based Engine",
        };
      }
      return {
        answer: `**ЖК «${matchedComplex.name}»: красная зона риска, ${score}/100 баллов.**\n\n` +
          `• **Застройщик:** ${dev}\n` +
          `• **Адрес объекта:** ${addr}\n` +
          `• **Статус в записи:** ${status}\n\n` +
          `${recordNote} Красная зона задаёт приоритет проверки, но сама по себе не устанавливает нарушение закона и не подтверждает незаконность конкретной сделки. Сверьте документы и условия договора с уполномоченным органом.`,
        complex: matchedComplex,
        riskZone: "red",
        source: "SAQ Rule-based Engine",
      };
    }

    if (isGreen) {
      if (isKz) {
        return {
          answer: `**«${matchedComplex.name}» ТК: жасыл тәуекел аймағы, ${score}/100 балл.**\n\n` +
            `• **Құрылыс салушы:** ${dev}\n` +
            `• **Жазбадағы құқықтық мәртебе:** ${status}\n\n` +
            `${recordNote} Жасыл аймақ нысанның заңдылығы немесе құжаттардың қолданыста екені туралы кепілдік бермейді. Нақты құжаттар мен шартты тексеріңіз.`,
          complex: matchedComplex,
          riskZone: "green",
          source: "SAQ Rule-based Engine",
        };
      }
      return {
        answer: `**ЖК «${matchedComplex.name}»: зелёная зона риска, ${score}/100 баллов.**\n\n` +
          `• **Застройщик:** ${dev}\n` +
          `• **Статус в записи:** ${status}\n\n` +
          `${recordNote} Зелёная зона не является гарантией законности объекта или действительности документов. Проверьте оригиналы документов и условия договора.`,
        complex: matchedComplex,
        riskZone: "green",
        source: "SAQ Rule-based Engine",
      };
    }
  }

  // General shared construction legal answer
  if (isKz) {
    return {
      answer: `**Жалпы анықтама:** ҚР «Тұрғын үй құрылысына үлестік қатысу туралы» Заңының 7-бабы үлестік қатысуды ұйымдастырудың үш тәсілін атайды: Бірыңғай оператор кепілдігі, екінші деңгейдегі банктің жобаға қатысуы және үй қаңқасы тұрғызылғаннан кейін қаражат тарту.\n\n` +
        `Нақты мәміленің заңдылығы шарттың мазмұнына, тараптарға және құжаттарға байланысты; тек жарнамаға қарап қорытынды жасауға болмайды. SAQ QURYLYS ресми тізілімдерді тікелей тексермейді. Қолданыстағы редакцияны ИПС «Әділеттен» және рұқсатты уәкілетті органнан тексеріңіз.`,
      source: "SAQ Rule-based Engine",
    };
  }

  return {
    answer: `**Общая справка:** статья 7 Закона РК № 486-V перечисляет три способа организации долевого участия: гарантия Единого оператора, участие в проекте банка второго уровня и привлечение денег после возведения каркаса.\n\n` +
      `Законность конкретной сделки зависит от условий договора, сторон и документов; по одной рекламе нельзя установить нарушение. SAQ QURYLYS не подключён к официальным реестрам и не подтверждает разрешения. Проверьте действующую редакцию в ИПС «Әділет» и документы в уполномоченном органе.`,
    source: "SAQ Rule-based Engine",
  };
}

export async function consultAiAssistant({ query, lang = "ru", db }) {
  if (!query || !query.trim()) {
    throw new Error("Запрос не может быть пустым.");
  }

  const config = getAiConfig();
  const matchedList = findMentionedComplexes(db, query);
  const matched = matchedList[0] || null;

  // If DeepSeek is configured and active, call DeepSeek LLM
  if (config.provider === "deepseek" && config.apiKey) {
    try {
      let contextAddition = "";
      if (matched) {
        const dev = matched.developerName || matched.developer_name || "Не указан";
        const addr = matched.address || "Усть-Каменогорск";
        const status = matched.legalBasisStatus || matched.legal_basis_status || "UNKNOWN";
        const score = matched.risk?.score ?? matched.score ?? 0;
        const category = matched.displayCategory || "yellow";
        const demoNote = matched.isDemo ? "ВНИМАНИЕ: карточка синтетическая и не относится к реальному объекту. " : "Данные карточки не подтверждаются автоматической сверкой с госреестрами. ";
        contextAddition = `\n[СПРАВКА ИЗ БАЗЫ SAQ QURYLYS ПО УПОМЯНУТОМУ ОБЪЕКТУ]:
Название ЖК: ${matched.name}
Застройщик: ${dev}
Адрес: ${addr}
${demoNote}Правовой статус в записи: ${status} (это значение приложения, а не самостоятельное подтверждение юридического статуса)
Балл риска: ${score} / 100 (зона ${category}; индикатор проверки, не юридический вывод)
Количество рекламы: ${matched.advertisementCount || 0}`;
      }

      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(Number(config.timeoutMs) || 20000),
        headers: {
          Authorization: "Bearer " + config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model || "deepseek-chat",
          messages: [
            {
              role: "system",
              content: KAZAKHSTAN_LEGAL_SYSTEM_PROMPT + contextAddition +
                (lang === "kz" || lang === "kk" ? "\nЖауапты қазақ тілінде беріңіз." : "\nОтвечайте на русском языке."),
            },
            {
              role: "user",
              content: query,
            },
          ],
          temperature: 0.2,
          max_tokens: 800,
        }),
      });

      if (!response.ok) {
        throw new Error("DeepSeek API error: HTTP " + response.status);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        return {
          answer: content.trim(),
          complex: matched,
          model: data.model || config.model || "deepseek-chat",
          source: "DeepSeek API · " + (data.model || config.model || "модель не указана"),
        };
      }
    } catch (err) {
      console.warn("DeepSeek assistant fallback to local rules:", err.message);
    }
  }

  // Fallback to local intelligent legal consultant
  return generateLocalConsultation(query, matched, lang);
}

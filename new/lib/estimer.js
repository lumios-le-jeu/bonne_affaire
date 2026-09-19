require('dotenv').config(); // Assurez-vous d'avoir dotenv installé (npm install dotenv)
const fs = require('fs');
const { chatJSON, imagePart, estimateCost } = require('./deepseek');

async function evaluerObjet(cheminImage) {
  if (!fs.existsSync(cheminImage)) {
    console.error(`Erreur : L'image ${cheminImage} est introuvable.`);
    return;
  }

  // 1. Lecture de l'image en buffer
  const imageBuffer = fs.readFileSync(cheminImage);

  // 2. Préparation du prompt strict
  const prompt = `
    Analyse attentivement cette image. 
    1. Identifie l'objet, sa marque, son modèle et son état visuel apparent.
    2. Estime sa valeur marchande actuelle en euros (€) sur le marché de la seconde main.
    
    Réponds EXCLUSIVEMENT sous la forme d'un objet JSON strict respectant cette structure :
    {
        "objet": "Nom complet et précis de l'objet identifié",
        "etat": "Neuf / Très bon état / Bon état / Usagé",
        "prix_min": 0.0,
        "prix_median": 0.0,
        "prix_max": 0.0,
        "devise": "EUR",
        "explication": "Brève synthèse justifiant l'estimation (1 à 2 phrases)"
    }`;

  // 3. Construction des messages avec le format attendu par ton wrapper
  const messages = [
    {
      role: "system",
      content: "Tu es un expert en expertise d'objets d'occasion et estimation de biens."
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        imagePart(imageBuffer, "original") // Utilisation de ta fonction pour la data URL
      ]
    }
  ];

  console.log("Envoi de l'image à DeepSeek et analyse en cours...\n");

  try {
    // 4. Appel avec la fonction résiliente chatJSON
    const resultat = await chatJSON(messages, { maxTokens: 800 });

    const data = resultat.data;
    const symbole = data.devise === "EUR" ? "€" : data.devise;

    console.log("=============================================");
    console.log(`Objet identifié : ${data.objet}`);
    console.log(`État estimé     : ${data.etat}`);
    console.log("---------------------------------------------");
    console.log(`Prix Minimum    : ${data.prix_min} ${symbole}`);
    console.log(`Prix Médian     : ${data.prix_median} ${symbole}`);
    console.log(`Prix Maximum    : ${data.prix_max} ${symbole}`);
    console.log("---------------------------------------------");
    console.log(`Analyse         : ${data.explication}`);
    console.log("=============================================\n");

    // 5. Affichage des métriques et du coût de ton wrapper
    const cout = estimateCost(resultat.usage);
    console.log(`[Métriques] Tentatives : ${resultat.tentatives}`);
    if (cout) {
      console.log(`[Coût API]  ${cout.usd}$ (${cout.tarif}) - In: ${cout.usage.prompt_tokens} | Out: ${cout.usage.completion_tokens}`);
    }

  } catch (erreur) {
    console.error("Échec de l'estimation :", erreur.message);
  }
}

// Lancement du test avec une photo locale
const fichierTest = process.argv[2] || "./photo.jpg";
evaluerObjet(fichierTest);
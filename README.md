# Student Planner (React + Firebase + Cloudinary + Vercel)

Aplicatie web simpla pentru studenti:
- cont nou + login
- sesiune persistenta dupa refresh
- adaugare/editare/stergere activitati
- categorii: Tema, Examen, Proiect, Personal
- deadline, prioritate, status finalizat/nefinalizat
- filtre dupa categorie si status
- atasament fisier pe activitate (Cloudinary)
- reminder pe email (EmailJS)

## Tehnologii folosite
- React (frontend)
- Firebase Authentication (autentificare)
- Firebase Firestore (baza de date cloud)
- Cloudinary (fisiere atasate)
- EmailJS (reminder email)
- Vercel (host/deploy)

## 1) Setup local

```bash
npm install
```

Copiaza fisierul `.env.example` in `.env` si completeaza valorile Firebase:

```bash
cp .env.example .env
```

Pe Windows poti face manual:
- creezi fisierul `.env`
- copiezi variabilele din `.env.example`
- pui valorile din Firebase Console

Porneste proiectul:

```bash
npm run dev
```

## 2) Configurare Firebase (pas cu pas)

1. Intra pe [Firebase Console](https://console.firebase.google.com/) si creeaza un proiect.
2. Activeaza **Authentication**:
   - Authentication -> Get started
   - Sign-in method -> Email/Password -> Enable
3. Activeaza **Firestore Database**:
   - Firestore Database -> Create database
   - incepe in test mode (pentru demo/proiect)
4. Ia configurarea Web App:
   - Project settings -> General -> Your apps -> Web app
   - copiezi `apiKey`, `authDomain`, `projectId`, etc
   - le pui in fisierul `.env`

## 3) Structura datelor in Firestore

Colectie: `tasks`

Campuri per document:
- `title`
- `description`
- `category`
- `deadline`
- `priority`
- `completed`
- `userId`
- `createdAt`
- `attachmentName`
- `attachmentUrl`
- `attachmentId`

## 4) Reguli Firestore recomandate (minim sigur)

In Firestore -> Rules poti pune:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tasks/{taskId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
  }
}
```

## 5) Deploy pe Vercel

1. Urca codul pe GitHub.
2. Intra pe [Vercel](https://vercel.com/) si importi repository-ul.
3. In Project Settings -> Environment Variables adaugi toate variabilele `VITE_FIREBASE_*`, `VITE_CLOUDINARY_*` si `VITE_EMAILJS_*`.
4. Deploy.

Gata. Aplicatia va fi online si bifeaza:
- 2 servicii cloud de baza (Auth + Firestore)
- extra cloud: Cloudinary + EmailJS
- aplicatie live (Vercel)

## 6) Setup Cloudinary (rapid)

1. Intra pe [Cloudinary](https://cloudinary.com/) si fa cont (free).
2. In Dashboard copiezi `Cloud name`.
3. In Settings -> Upload -> Upload presets:
   - creezi un preset nou
   - setezi `Signing Mode` pe `Unsigned`
   - salvezi numele presetului
4. In `.env` completezi:
   - `VITE_CLOUDINARY_CLOUD_NAME`
   - `VITE_CLOUDINARY_UPLOAD_PRESET`

## 7) Setup EmailJS (rapid)

1. Intra pe [EmailJS](https://www.emailjs.com/) si fa cont.
2. Creeaza un Email Service (Gmail/Outlook).
3. Creeaza un Template simplu cu variabile:
   - `to_email`
   - `title`
   - `deadline`
   - `category`
   - `priority`
   - `message`
4. Din dashboard copiezi:
   - `Service ID` -> `VITE_EMAILJS_SERVICE_ID`
   - `Template ID` -> `VITE_EMAILJS_TEMPLATE_ID`
   - `Public Key` -> `VITE_EMAILJS_PUBLIC_KEY`

## Workflow aplicatie (pentru documentatie)

1. User isi face cont / se logheaza.
2. Firebase Authentication valideaza userul.
3. Aplicatia citeste/scrie task-urile in Firestore doar pentru acel user (`userId`).
4. User poate adauga, edita, sterge, marca finalizat si filtra activitati.
5. Aplicatia ramane autentificata dupa refresh (session persistence Firebase).

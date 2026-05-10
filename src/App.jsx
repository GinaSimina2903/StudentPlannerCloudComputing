import { useEffect, useMemo, useState } from "react";
import emailjs from "@emailjs/browser";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";

const categories = ["Tema", "Examen", "Proiect", "Personal"];
const priorities = ["Scazuta", "Medie", "Ridicata"];

const emptyTask = {
  title: "",
  description: "",
  category: "Tema",
  deadline: "",
  priority: "Medie",
  completed: false,
  attachmentName: "",
  attachmentUrl: "",
  attachmentId: "",
};

function getDeadlineStatus(deadline) {
  if (!deadline) return "normal";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dueDate = new Date(deadline);
  dueDate.setHours(0, 0, 0, 0);

  const dayDiff = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));

  if (dayDiff < 0) return "expired";
  if (dayDiff <= 2) return "urgent";
  if (dayDiff <= 7) return "soon";
  return "normal";
}

function toDateOnly(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isWithinCurrentWeek(deadline) {
  if (!deadline) return false;
  const today = toDateOnly(new Date());
  const day = today.getDay();
  const mondayShift = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayShift);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const dueDate = toDateOnly(deadline);
  return dueDate >= monday && dueDate <= sunday;
}

function isUrgent(deadline) {
  if (!deadline) return false;
  const today = toDateOnly(new Date());
  const dueDate = toDateOnly(deadline);
  const diffDays = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
  return diffDays <= 1;
}

async function uploadFileToCloudinary(file) {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error("Lipsesc variabilele Cloudinary in .env");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    {
      method: "POST",
      body: formData,
    },
  );

  const result = await response.json();

  if (!response.ok) {
    const errorMessage = result?.error?.message || "Upload Cloudinary esuat";
    throw new Error(errorMessage);
  }

  return {
    attachmentName: file.name,
    attachmentUrl: result.secure_url || "",
    attachmentId: result.public_id || "",
  };
}

function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authError, setAuthError] = useState("");

  const [tasks, setTasks] = useState([]);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [taskError, setTaskError] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [sendingDigest, setSendingDigest] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState("toate");
  const [statusFilter, setStatusFilter] = useState("toate");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("noi");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser ?? null);
      setLoadingAuth(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setTasks([]);
      return;
    }

    const tasksQuery = query(collection(db, "tasks"), where("userId", "==", user.uid));

    const unsubscribe = onSnapshot(
      tasksQuery,
      (snapshot) => {
        const docs = snapshot.docs.map((taskDoc) => ({
          id: taskDoc.id,
          ...taskDoc.data(),
        }));
        setTasks(docs);
      },
      () => {
        setTaskError("Nu am putut incarca activitatile. Verifica regulile Firestore.");
      },
    );

    return () => unsubscribe();
  }, [user]);

  const filteredTasks = useMemo(() => {
    const priorityRank = { Ridicata: 3, Medie: 2, Scazuta: 1 };

    const filtered = tasks.filter((task) => {
      const searchOk =
        !searchTerm.trim() ||
        task.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.description?.toLowerCase().includes(searchTerm.toLowerCase());
      const categoryOk =
        categoryFilter === "toate" || task.category === categoryFilter;
      const statusOk =
        statusFilter === "toate" ||
        (statusFilter === "finalizate" && task.completed) ||
        (statusFilter === "nefinalizate" && !task.completed);
      return searchOk && categoryOk && statusOk;
    });

    return filtered.slice().sort((a, b) => {
      if (sortBy === "deadline") {
        const aDeadline = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER;
        const bDeadline = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER;
        return aDeadline - bDeadline;
      }

      if (sortBy === "prioritate") {
        return (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
      }

      const aTime = a.createdAt?.seconds ?? 0;
      const bTime = b.createdAt?.seconds ?? 0;
      return bTime - aTime;
    });
  }, [tasks, categoryFilter, statusFilter, searchTerm, sortBy]);

  const completedCount = tasks.filter((task) => task.completed).length;
  const pendingCount = tasks.length - completedCount;
  const completionRate = tasks.length
    ? Math.round((completedCount / tasks.length) * 100)
    : 0;
  const weeklyTasks = useMemo(
    () =>
      tasks
        .filter((task) => !task.completed && isWithinCurrentWeek(task.deadline))
        .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()),
    [tasks],
  );
  const urgentTasks = useMemo(
    () => weeklyTasks.filter((task) => isUrgent(task.deadline)),
    [weeklyTasks],
  );

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");

    try {
      if (isRegisterMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      setEmail("");
      setPassword("");
    } catch (error) {
      setAuthError("Email sau parola invalida. Incearca din nou.");
    }
  }

  async function handleTaskSubmit(event) {
    event.preventDefault();
    setTaskError("");

    if (!user) return;

    if (!taskForm.title || !taskForm.deadline) {
      setTaskError("Titlul si deadline-ul sunt obligatorii.");
      return;
    }

    try {
      let attachmentData = {
        attachmentName: taskForm.attachmentName || "",
        attachmentUrl: taskForm.attachmentUrl || "",
        attachmentId: taskForm.attachmentId || "",
      };

      if (selectedFile) {
        attachmentData = await uploadFileToCloudinary(selectedFile);
      }

      const payload = {
        ...taskForm,
        ...attachmentData,
        userId: user.uid,
      };

      if (editingTaskId) {
        await updateDoc(doc(db, "tasks", editingTaskId), payload);
        setEditingTaskId(null);
      } else {
        await addDoc(collection(db, "tasks"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setTaskForm(emptyTask);
      setSelectedFile(null);
    } catch (error) {
      const message = error?.message || "";
      if (message.toLowerCase().includes("upload preset")) {
        setTaskError(
          "Cloudinary preset invalid. Verifica numele presetului si sa fie Unsigned.",
        );
      } else {
        setTaskError(`Nu am putut salva activitatea. ${message}`.trim());
      }
    }
  }

  async function handleToggleComplete(taskId, completed) {
    await updateDoc(doc(db, "tasks", taskId), { completed: !completed });
  }

  async function handleDelete(taskId) {
    await deleteDoc(doc(db, "tasks", taskId));
  }

  function startEditing(task) {
    setEditingTaskId(task.id);
    setTaskForm({
      title: task.title || "",
      description: task.description || "",
      category: task.category || "Tema",
      deadline: task.deadline || "",
      priority: task.priority || "Medie",
      completed: !!task.completed,
      attachmentName: task.attachmentName || "",
      attachmentUrl: task.attachmentUrl || "",
      attachmentId: task.attachmentId || "",
    });
    setSelectedFile(null);
  }

  function cancelEditing() {
    setEditingTaskId(null);
    setTaskForm(emptyTask);
    setSelectedFile(null);
  }

  async function sendWeeklyDigestEmail(taskList) {
    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

    if (!serviceId || !templateId || !publicKey) {
      setTaskError(
        "Completeaza in .env variabilele EmailJS (SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY).",
      );
      return;
    }

    if (!taskList.length) {
      setTaskError("Nu exista task-uri urgente in aceasta saptamana.");
      return;
    }

    const summary = taskList
      .map(
        (task, index) =>
          [
            `${index + 1}) ${task.title}`,
            `   - Categorie: ${task.category}`,
            `   - Prioritate: ${task.priority}`,
            `   - Deadline: ${task.deadline}`,
            `   - Detalii: ${task.description || "Fara descriere"}`,
          ].join("\n"),
      )
      .join("\n\n");

    try {
      setTaskError("");
      setSendingDigest(true);
      await emailjs.send(
        serviceId,
        templateId,
        {
          to_email: user.email,
          title: "Calendar task-uri urgente",
          deadline: "Saptamana curenta",
          category: "Student Planner",
          priority: "General",
          message: `Ai ${taskList.length} task-uri urgente:\n\n${summary}`,
          summary,
          tasks_count: taskList.length,
        },
        { publicKey },
      );
      setTaskError("Calendarul de task-uri urgente a fost trimis pe email.");
    } catch {
      setTaskError("Nu am putut trimite emailul. Verifica setarile EmailJS.");
    } finally {
      setSendingDigest(false);
    }
  }

  function handleManualDigest() {
    sendWeeklyDigestEmail(urgentTasks);
  }

  function clearTaskError() {
    if (taskError) {
      setTaskError("");
    }
  }

  if (loadingAuth) {
    return <p className="center-message">Se incarca aplicatia...</p>;
  }

  if (!user) {
    return (
      <main className="container auth-container">
        <h1>Student Planner</h1>
        <p>Organizeaza teme, examene, proiecte si deadline-uri.</p>

        <form className="card form" onSubmit={handleAuthSubmit}>
          <h2>{isRegisterMode ? "Creeaza cont" : "Autentificare"}</h2>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Parola (minim 6 caractere)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={6}
            required
          />

          {authError && <p className="error">{authError}</p>}

          <button type="submit" className="primary">
            {isRegisterMode ? "Creeaza cont" : "Intra in cont"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setIsRegisterMode((value) => !value)}
          >
            {isRegisterMode
              ? "Ai deja cont? Autentifica-te"
              : "Nu ai cont? Inregistreaza-te"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="container">
      <header className="header-row">
        <div>
          <h1>Student Planner</h1>
          <p>Bine ai venit, {user.email}</p>
        </div>
        <button className="ghost" onClick={() => signOut(auth)}>
          Logout
        </button>
      </header>
      <section className="card">
        <h2>Email reminder general</h2>
        <p>
          Trimite manual un email cu task-urile urgente (deadline in maxim 24h).
          Acum ai {urgentTasks.length} task-uri urgente.
        </p>
        <div className="row">
          <button className="ghost" onClick={handleManualDigest} disabled={sendingDigest}>
            {sendingDigest ? "Se trimite..." : "Trimite calendar task-uri urgente"}
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <article className="card stat-card">
          <p>Total activitati</p>
          <strong>{tasks.length}</strong>
        </article>
        <article className="card stat-card">
          <p>Finalizate</p>
          <strong>{completedCount}</strong>
        </article>
        <article className="card stat-card">
          <p>Nefinalizate</p>
          <strong>{pendingCount}</strong>
        </article>
        <article className="card stat-card">
          <p>Progres</p>
          <strong>{completionRate}%</strong>
        </article>
      </section>

      <section className="card">
        <h2>{editingTaskId ? "Editeaza activitatea" : "Adauga activitate"}</h2>
        <form className="form" onSubmit={handleTaskSubmit}>
          <label className="input-group">
            <span>Titlu activitate</span>
            <input
              type="text"
              placeholder="Ex: Tema baze de date"
              value={taskForm.title}
              onChange={(event) =>
                setTaskForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </label>
          <label className="input-group">
            <span>Descriere</span>
            <textarea
              placeholder="Scrie detalii scurte..."
              value={taskForm.description}
              onChange={(event) =>
                setTaskForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </label>

          <div className="grid">
            <label className="input-group">
              <span>Categorie</span>
              <select
                value={taskForm.category}
                onChange={(event) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    category: event.target.value,
                  }))
                }
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className="input-group">
              <span>Prioritate</span>
              <select
                value={taskForm.priority}
                onChange={(event) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    priority: event.target.value,
                  }))
                }
              >
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>

            <label className="input-group">
              <span>Deadline</span>
              <input
                type="date"
                value={taskForm.deadline}
                onChange={(event) =>
                  setTaskForm((prev) => ({ ...prev, deadline: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="input-group">
            <span>Fisier atasat (optional)</span>
            <input
              type="file"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                clearTaskError();
              }}
            />
            {!selectedFile && taskForm.attachmentUrl && (
              <small>
                Atasament existent:{" "}
                <a href={taskForm.attachmentUrl} target="_blank" rel="noreferrer">
                  {taskForm.attachmentName || "Deschide fisier"}
                </a>
              </small>
            )}
          </label>

          {taskError && <p className="error">{taskError}</p>}

          <div className="row">
            <button type="submit" className="primary">
              {editingTaskId ? "Salveaza modificarile" : "Adauga"}
            </button>
            {editingTaskId && (
              <button type="button" className="ghost" onClick={cancelEditing}>
                Renunta editare
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Filtre</h2>
        <div className="grid">
          <label className="input-group">
            <span>Filtru categorie</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="toate">Toate categoriile</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="input-group">
            <span>Filtru status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="toate">Toate statusurile</option>
              <option value="nefinalizate">Nefinalizate</option>
              <option value="finalizate">Finalizate</option>
            </select>
          </label>
        </div>
        <label className="input-group">
          <span>Cautare rapida</span>
          <input
            type="text"
            placeholder="Cauta dupa titlu sau descriere..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        <label className="input-group">
          <span>Sortare</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="noi">Cele mai noi</option>
            <option value="deadline">Deadline apropiat</option>
            <option value="prioritate">Prioritate mare</option>
          </select>
        </label>
      </section>

      {!!tasks.length && (
        <section className="card">
          <h2>Progres general</h2>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${completionRate}%` }} />
          </div>
          <p>{completionRate}% dintre activitati sunt finalizate.</p>
        </section>
      )}

      <section className="task-list">
        {filteredTasks.length === 0 ? (
          <p className="center-message">Nu exista activitati pentru filtrele selectate.</p>
        ) : (
          filteredTasks.map((task) => (
            <article
              className={`card task-item ${getDeadlineStatus(task.deadline)}`}
              key={task.id}
            >
              <div className="row space-between">
                <h3>
                  {task.title} {task.completed ? "✅" : ""}
                </h3>
                <span className={`badge ${task.priority?.toLowerCase()}`}>
                  {task.priority}
                </span>
              </div>
              <p>{task.description}</p>
              <p>
                <strong>Categorie:</strong> {task.category}
              </p>
              <p>
                <strong>Deadline:</strong> {task.deadline}
              </p>
              {task.attachmentUrl && (
                <p>
                  <strong>Atasament:</strong>{" "}
                  <a href={task.attachmentUrl} target="_blank" rel="noreferrer">
                    {task.attachmentName || "Deschide fisier"}
                  </a>
                </p>
              )}
              <p className="deadline-hint">
                {getDeadlineStatus(task.deadline) === "expired" && "Depasit"}
                {getDeadlineStatus(task.deadline) === "urgent" && "Urgent (0-2 zile)"}
                {getDeadlineStatus(task.deadline) === "soon" && "Se apropie (max 7 zile)"}
              </p>
              <div className="row">
                <button
                  className="ghost"
                  onClick={() => handleToggleComplete(task.id, task.completed)}
                >
                  {task.completed ? "Marcheaza nefinalizata" : "Marcheaza finalizata"}
                </button>
                <button className="ghost" onClick={() => startEditing(task)}>
                  Editeaza
                </button>
                <button className="danger" onClick={() => handleDelete(task.id)}>
                  Sterge
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

export default App;

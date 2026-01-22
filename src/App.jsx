// src/App.jsx
import React, { useEffect, useState } from 'react';
import './style.css';

const API_BASE = '/api'; // Vite proxy should send this to http://localhost:4000

// Small helper to reduce boilerplate
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export default function App() {
  // Navigation / auth
  const [view, setView] = useState('auth'); // 'auth' | 'profile' | 'menu' | 'shopping'
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  // Profile
  const [goal, setGoal] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [gender, setGender] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activityLevel, setActivityLevel] = useState('');

  // Menu & shopping
  const [menu, setMenu] = useState(null); // { version, dailyCalories, days[], generatedAt, warning? }
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [menuProgress, setMenuProgress] = useState(0);

  // Global error info
  const [appError, setAppError] = useState('');

  // ---------------- AUTO-LOGIN ON LOAD ----------------

  useEffect(() => {
    const storedEmail = localStorage.getItem('currentUserEmail');
    if (!storedEmail) return;

    (async () => {
      try {
        const data = await fetchJson(
          `${API_BASE}/auth/user?email=${encodeURIComponent(storedEmail)}`
        );
        const user = data.user;
        setCurrentUser(user);
        if (user.profile) {
          const p = user.profile;
          setGoal(p.goal || '');
          setAgeRange(p.ageRange || '');
          setGender(p.gender || '');
          setHeight(
            typeof p.heightCm === 'number' ? p.heightCm.toString() : ''
          );
          setWeight(
            typeof p.weightKg === 'number' ? p.weightKg.toString() : ''
          );
          setActivityLevel(p.activityLevel || '');
        }
        setView('menu');
      } catch (err) {
        console.error('Auto-login failed:', err);
        localStorage.removeItem('currentUserEmail');
        setCurrentUser(null);
        setView('auth');
      }
    })();
  }, []);

  // ---------------- AUTH HANDLERS ----------------

  async function handleSignUp(e) {
    e.preventDefault();
    setAuthError('');
    setAppError('');

    if (!authEmail || !authPassword) {
      setAuthError('Email and password are required.');
      return;
    }
    if (authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    try {
      const data = await fetchJson(`${API_BASE}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });

      const user = data.user;
      setCurrentUser(user);
      localStorage.setItem('currentUserEmail', user.email);
      setAuthPassword('');
      setView('profile');
    } catch (err) {
      console.error('Sign up error:', err);
      setAuthError(err.message);
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setAuthError('');
    setAppError('');

    if (!authEmail || !authPassword) {
      setAuthError('Email and password are required.');
      return;
    }

    try {
      const data = await fetchJson(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });

      const user = data.user;
      setCurrentUser(user);
      localStorage.setItem('currentUserEmail', user.email);
      setAuthPassword('');

      if (user.profile) {
        const p = user.profile;
        setGoal(p.goal || '');
        setAgeRange(p.ageRange || '');
        setGender(p.gender || '');
        setHeight(
          typeof p.heightCm === 'number' ? p.heightCm.toString() : ''
        );
        setWeight(
          typeof p.weightKg === 'number' ? p.weightKg.toString() : ''
        );
        setActivityLevel(p.activityLevel || '');
      }

      setView('menu');
    } catch (err) {
      console.error('Sign in error:', err);
      setAuthError(err.message);
    }
  }

  function handleLogout() {
    setCurrentUser(null);
    localStorage.removeItem('currentUserEmail');
    setMenu(null);
    setAppError('');
    setView('auth');
  }

  // ---------------- PROFILE HANDLER ----------------

  async function handleSaveProfile(e) {
    e.preventDefault();
    setAppError('');

    if (!currentUser) {
      setAppError('You must be signed in to save profile.');
      return;
    }

    if (!goal || !ageRange || !gender || !height || !weight || !activityLevel) {
      setAppError('Please complete all profile fields.');
      return;
    }

    const profile = {
      goal,
      ageRange,
      gender,
      heightCm: Number(height),
      weightKg: Number(weight),
      activityLevel
    };

    try {
      const data = await fetchJson(`${API_BASE}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ email: currentUser.email, profile })
      });

      const user = data.user;
      setCurrentUser(user);
      setView('menu');
    } catch (err) {
      console.error('Save profile error:', err);
      setAppError(err.message);
    }
  }

  // ---------------- MENU GENERATION / REFRESH ----------------

  async function handleGenerateMenu(forceRefresh = false) {
    setAppError('');

    if (!currentUser) {
      setAppError('You must be signed in to generate a menu.');
      setView('auth');
      return;
    }

    // Require full profile
    if (!goal || !ageRange || !gender || !height || !weight || !activityLevel) {
      setAppError('Please fill in your profile first.');
      setView('profile');
      return;
    }

    const profile = {
      goal,
      ageRange,
      gender,
      heightCm: Number(height),
      weightKg: Number(weight),
      activityLevel
    };

    setLoadingMenu(true);
    setMenuProgress(10);

    // Simulated progress bar
    const timer = setInterval(() => {
      setMenuProgress((p) => {
        if (p >= 90) return p;
        return p + 10;
      });
    }, 350);

    try {
      const data = await fetchJson(`${API_BASE}/generate-weekly-menu`, {
        method: 'POST',
        body: JSON.stringify({
          email: currentUser.email,
          profile,
          forceRefresh
        })
      });

      // Add "bought" flag to shopping items
      const enhancedDays = (data.days || []).map((day) => ({
        ...day,
        shoppingItems: (day.shoppingItems || []).map((item) => ({
          ...item,
          bought: false
        }))
      }));

      setMenu({
        ...data,
        days: enhancedDays
      });

      setMenuProgress(100);
      setTimeout(() => setMenuProgress(0), 800);
    } catch (err) {
      console.error('Generate menu error:', err);
      setAppError(err.message || 'Something went wrong while generating menu.');
    } finally {
      clearInterval(timer);
      setLoadingMenu(false);
    }
  }

  // Toggle "bought" per day
  function toggleBought(dayIndex, itemIndex) {
    if (!menu) return;

    const clone = {
      ...menu,
      days: menu.days.map((d) => ({
        ...d,
        shoppingItems: [...(d.shoppingItems || [])]
      }))
    };

    const dayPos = clone.days.findIndex((d) => d.dayIndex === dayIndex);
    if (dayPos === -1) return;

    const items = clone.days[dayPos].shoppingItems || [];
    if (!items[itemIndex]) return;

    items[itemIndex] = {
      ...items[itemIndex],
      bought: !items[itemIndex].bought
    };

    setMenu(clone);
  }

  // ---------------- RENDER SECTIONS ----------------

  function renderAuth() {
    return (
      <div className="card auth-card">
        <h1 className="app-title">🥗 Nutrition Planning App</h1>
        <p className="app-subtitle">
          AI-powered weekly menus and smart shopping lists.
        </p>

        <div className="auth-toggle">
          <button
            className={authMode === 'signin' ? 'btn primary' : 'btn ghost'}
            onClick={() => {
              setAuthMode('signin');
              setAuthError('');
            }}
          >
            Sign in
          </button>
          <button
            className={authMode === 'signup' ? 'btn primary' : 'btn ghost'}
            onClick={() => {
              setAuthMode('signup');
              setAuthError('');
            }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={authMode === 'signup' ? handleSignUp : handleSignIn}>
          <label>
            Email
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
            />
          </label>

          {authError && <p className="error-text">{authError}</p>}

          <button type="submit" className="btn primary full-width">
            {authMode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  function renderProfile() {
    return (
      <div className="card">
        <div className="card-header">
          <h2>👤 Tell us about you</h2>
          <button className="btn ghost small" onClick={() => setView('menu')}>
            ← Back to menu
          </button>
        </div>

        <form onSubmit={handleSaveProfile} className="profile-grid">
          <label>
            Goal
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              required
            >
              <option value="">Select goal</option>
              <option>Lose weight</option>
              <option>Maintain weight</option>
              <option>Gain weight</option>
            </select>
          </label>

          <label>
            Age range
            <select
              value={ageRange}
              onChange={(e) => setAgeRange(e.target.value)}
              required
            >
              <option value="">Select range</option>
              <option>18-24</option>
              <option>25-34</option>
              <option>35-44</option>
              <option>45-54</option>
              <option>55-64</option>
              <option>65+</option>
            </select>
          </label>

          <label>
            Gender
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              required
            >
              <option value="">Select gender</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </label>

          <label>
            Height (cm)
            <input
              type="number"
              min="120"
              max="230"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              required
            />
          </label>

          <label>
            Weight (kg)
            <input
              type="number"
              min="30"
              max="250"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              required
            />
          </label>

          <label>
            Activity level
            <select
              value={activityLevel}
              onChange={(e) => setActivityLevel(e.target.value)}
              required
            >
              <option value="">Select level</option>
              <option>Sedentary - 0 hours/week</option>
              <option>Light - 0-1 hour/week</option>
              <option>Moderate - 1-2 hours/week</option>
              <option>Active - 2-4 hours/week</option>
              <option>Very Active - 4+ hours/week</option>
            </select>
          </label>

          {appError && <p className="error-text full-width">{appError}</p>}

          <div className="full-width buttons-row">
            <button type="submit" className="btn primary">
              Save profile
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setView('menu')}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  function renderMenu() {
    return (
      <div>
        <div className="top-bar">
          <div>
            <h1 className="app-title">🥗 Nutrition Planning App</h1>
            <p className="app-subtitle">
              AI weekly menu for{' '}
              {currentUser ? <strong>{currentUser.email}</strong> : 'guest'}.
            </p>
          </div>
          <div className="top-bar-buttons">
            <button className="btn ghost" onClick={() => setView('profile')}>
              ✏️ Edit profile
            </button>
            <button className="btn ghost" onClick={handleLogout}>
              🚪 Log out
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2>📅 Weekly menu</h2>
              {menu && (
                <p className="menu-meta">
                  Version: <strong>{menu.version}</strong> • Generated on{' '}
                  {new Date(menu.generatedAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="buttons-row">
              <button
                className="btn primary"
                onClick={() => handleGenerateMenu(false)}
                disabled={loadingMenu}
              >
                {loadingMenu ? 'Generating…' : 'Generate menu'}
              </button>
              {menu && (
                <>
                  <button
                    className="btn ghost"
                    onClick={() => handleGenerateMenu(true)}
                    disabled={loadingMenu}
                  >
                    🔄 Refresh menu
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => setView('shopping')}
                  >
                    🛒 Shopping list
                  </button>
                </>
              )}
            </div>
          </div>

          {loadingMenu && (
            <div className="progress-wrapper">
              <div className="progress-label">
                Generating your weekly menu… please wait.
              </div>
              <div className="progress-bar">
                <div
                  className="progress-inner"
                  style={{ width: `${menuProgress}%` }}
                />
              </div>
            </div>
          )}

          {appError && <p className="error-text">{appError}</p>}

          {menu && (
            <div>
              <p className="menu-meta">
                🎯 Target daily calories:{' '}
                <strong>{menu.dailyCalories}</strong> kcal
              </p>
              {menu.warning && (
                
                <p className="warning-text">⚠️ {menu.warning}</p>
              )}
              {menu.emailStatus === 'sent' && (
                <p className="success-text">
                  📧 This menu was emailed to <strong>{currentUser.email}</strong>.
                </p>
              )}
              {menu.emailStatus === 'failed' && (
                <p className="warning-text">
                  ⚠️ The menu was created but could not be emailed. Check the server SMTP settings.
                </p>
              )}
              {menu.emailStatus === 'not_configured' && (
                <p className="warning-text">
                  ⚠️ Email sending is not configured on the server (SMTP settings missing).
                </p>
              )}

              <div className="day-grid">
                {menu.days.map((day) => (
                  <div key={day.dayIndex} className="day-card">
                    <div className="day-header">
                      <span className="day-icon">📆</span>
                      <div>
                        <div className="day-label">{day.label}</div>
                        <div className="day-sub">
                          {day.meals?.length || 0} meals ·{' '}
                          {(day.shoppingItems || []).length} items to buy
                        </div>
                      </div>
                    </div>

                    <div className="meals-list">
                      {(day.meals || []).map((meal, idx) => (
                        <div key={idx} className="meal-row">
                          <div className="meal-type">
                            {meal.type === 'Breakfast' && '🍳'}
                            {meal.type === 'Lunch' && '🥗'}
                            {meal.type === 'Dinner' && '🍽️'}{' '}
                            <span>{meal.type}</span>
                          </div>
                          <div className="meal-main">
                            <div className="meal-name">{meal.name}</div>
                            {meal.description && (
                              <div className="meal-desc">
                                {meal.description}
                              </div>
                            )}
                          </div>
                          <div className="meal-calories">
                            {meal.calories ? `${meal.calories} kcal` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!menu && !loadingMenu && (
            <p className="hint-text">
              No menu yet. Fill your profile and click{' '}
              <strong>Generate menu</strong> to get your first week.
            </p>
          )}
        </div>
      </div>
    );
  }

  function renderShopping() {
    if (!menu) {
      return (
        <div className="card">
          <div className="card-header">
            <h2>🛒 Shopping list</h2>
            <button className="btn ghost small" onClick={() => setView('menu')}>
              ← Back to menu
            </button>
          </div>
          <p>You don’t have a menu yet. Generate a menu first.</p>
        </div>
      );
    }

    return (
      <div className="card">
        <div className="card-header">
          <h2>🛒 Shopping list by day</h2>
          <button className="btn ghost small" onClick={() => setView('menu')}>
            ← Back to menu
          </button>
        </div>

        {menu.days.map((day) => (
          <div key={day.dayIndex} className="day-card compact">
            <div className="day-header">
              <span className="day-icon">🛍️</span>
              <div>
                <div className="day-label">{day.label}</div>
                <div className="day-sub">
                  {(day.shoppingItems || []).length} items to buy
                </div>
              </div>
            </div>

            {(day.shoppingItems || []).length === 0 ? (
              <p className="hint-text small">No items for this day.</p>
            ) : (
              <ul className="shopping-list">
                {day.shoppingItems.map((item, idx) => (
                  <li key={idx} className="shopping-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={!!item.bought}
                        onChange={() => toggleBought(day.dayIndex, idx)}
                      />
                      <span
                        className={
                          item.bought ? 'shopping-text bought' : 'shopping-text'
                        }
                      >
                        {item.product} – <strong>{item.quantity}</strong>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ---------------- DECIDE WHAT TO RENDER ----------------

  let content;
  if (!currentUser && view !== 'auth') {
    content = renderAuth();
  } else {
    if (view === 'auth') content = renderAuth();
    else if (view === 'profile') content = renderProfile();
    else if (view === 'menu') content = renderMenu();
    else if (view === 'shopping') content = renderShopping();
  }

  return <div className="app-root">{content}</div>;
}

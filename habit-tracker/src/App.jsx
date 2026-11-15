import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { defaultHabits } from './lib/defaultHabits';
import Dashboard from './components/Dashboard';
import History from './components/History';
import Settings from './components/Settings';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState('dashboard');

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Create default habits for a new user.
  async function createDefaultHabits(userId) {
    const { data: existingHabits, error: fetchError } = await supabase
      .from('habits')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (fetchError) throw fetchError;

    // Only seed accounts that have no habits yet.
    if (existingHabits.length === 0) {
      const habitsToInsert = defaultHabits.map((habit) => ({
        ...habit,
        user_id: userId,
      }));

      const { error: insertError } = await supabase
        .from('habits')
        .insert(habitsToInsert);

      if (insertError) throw insertError;
    }
  }

  // Check whether a user is already signed in.
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        if (mounted) {
          setError(error.message);
          setLoading(false);
        }
        return;
      }

      if (data.session?.user) {
        try {
          await createDefaultHabits(data.session.user.id);
        } catch (err) {
          if (mounted) setError(err.message);
        }
      }

      if (mounted) {
        setUser(data.session?.user ?? null);
        setLoading(false);
      }
    }

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        if (data.session?.user) {
          await createDefaultHabits(data.session.user.id);
          setUser(data.session.user);
        } else {
          setMessage(
            'Account created! Check your email for a confirmation link, then sign in.'
          );
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        await createDefaultHabits(data.user.id);
        setUser(data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    setPage('dashboard');

    if (error) {
      setError(error.message);
    } else {
      setUser(null);
      setMessage('');
    }
  }

  if (loading) {
    return (
      <main className="app-shell">
        <p className="loading-text">Loading your tracker...</p>
      </main>
    );
  }

  if (user) {
    if (page === 'settings') {
      return (
        <Settings
          user={user}
          onBack={() => setPage('dashboard')}
        />
      );
    }

    if (page === 'history') {
      return (
        <History
          user={user}
          onBack={() => setPage('dashboard')}
          onOpenSettings={() => setPage('settings')}
          onSignOut={handleSignOut}
        />
      );
    }

    return (
      <Dashboard
        user={user}
        onSignOut={handleSignOut}
        onOpenSettings={() => setPage('settings')}
        onOpenHistory={() => setPage('history')}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="auth-card">
        <div className="brand-mark">H</div>

        <p className="eyebrow">BUILD BETTER, EVERY DAY</p>

        <h1>{isSignUp ? 'Create your account.' : 'Welcome back.'}</h1>

        <p className="auth-description">
          {isSignUp
            ? 'Start tracking the habits that move you forward.'
            : 'Sign in to continue building your habits.'}
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 6 characters"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={6}
            required
          />

          {error && <p className="feedback error">{error}</p>}
          {message && <p className="feedback success">{message}</p>}

          <button
            className="primary-button"
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? 'Please wait...'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <div className="auth-toggle">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
              setMessage('');
            }}
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </button>
        </div>
      </section>
    </main>
  );
}
from datetime import date

import app as marquee_app


def _client():
    marquee_app.app.config.update(TESTING=True)
    return marquee_app.app.test_client()


def test_trivia_future_puzzle_redirects_to_today(monkeypatch):
    client = _client()
    monkeypatch.setattr(marquee_app, "current_site_date", lambda: date(2026, 4, 3))
    monkeypatch.setattr(
        marquee_app,
        "get_trivia_puzzle",
        lambda puzzle_date: {"date": puzzle_date, "questions": [1, 2, 3]} if puzzle_date == "2026-04-03" else None,
    )

    response = client.get("/trivia/2026-04-04")

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/trivia/2026-04-03")


def test_marquee_future_puzzle_redirects_to_today(monkeypatch):
    client = _client()
    monkeypatch.setattr(marquee_app, "current_site_date", lambda: date(2026, 4, 3))
    monkeypatch.setattr(
        marquee_app,
        "get_puzzle",
        lambda puzzle_date: {"date": puzzle_date, "categories": []} if puzzle_date == "2026-04-03" else None,
    )

    response = client.get("/marquee/2026-04-04")

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/marquee/2026-04-03")


def test_random_movies_rejects_non_integer_count(monkeypatch):
    client = _client()
    monkeypatch.setattr(marquee_app, "get_movies", lambda: [{"id": 1, "title": "Movie", "year": 2000}])

    response = client.get("/api/random-movies?count=abc")

    assert response.status_code == 400
    assert response.get_json()["error"] == "count must be an integer"


def test_admin_trivia_add_rejects_non_integer_difficulty(monkeypatch):
    client = _client()
    monkeypatch.setattr(marquee_app, "get_trivia_questions", lambda: [])

    with client.session_transaction() as session:
        session["admin"] = True

    response = client.post(
        "/admin/trivia/questions",
        json={
            "question": "Who directed Jaws?",
            "answer": "Steven Spielberg",
            "difficulty": "hard",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "difficulty must be an integer from 1 to 10"


def test_safe_default_uses_dev_default_only_in_dev(monkeypatch):
    monkeypatch.delenv("TEST_SECRET", raising=False)

    assert marquee_app._env_or_safe_default(
        "TEST_SECRET",
        dev_default="dev-secret",
        dev_mode=True,
        label="test secret",
    ) == "dev-secret"

    generated = marquee_app._env_or_safe_default(
        "TEST_SECRET",
        dev_default="dev-secret",
        dev_mode=False,
        label="test secret",
    )

    assert generated != "dev-secret"
    assert len(generated) == 64

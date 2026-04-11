import json
import pytest
import app as marquee_app


def _client():
    marquee_app.app.config.update(TESTING=True)
    return marquee_app.app.test_client()


def _admin(client):
    with client.session_transaction() as s:
        s["admin"] = True


class TestGenerationSettings:
    def test_get_returns_defaults_when_file_missing(self, monkeypatch, tmp_path):
        monkeypatch.setattr(marquee_app, "TRIVIA_GENERATION_SETTINGS_PATH", tmp_path / "trivia_generation.json")
        client = _client()
        _admin(client)
        res = client.get("/admin/trivia/generation-settings")
        assert res.status_code == 200
        assert res.get_json() == {"style_notes": ""}

    def test_post_saves_style_notes(self, monkeypatch, tmp_path):
        path = tmp_path / "trivia_generation.json"
        monkeypatch.setattr(marquee_app, "TRIVIA_GENERATION_SETTINGS_PATH", path)
        client = _client()
        _admin(client)
        res = client.post(
            "/admin/trivia/generation-settings",
            json={"style_notes": "Avoid yes/no answers."},
        )
        assert res.status_code == 200
        assert res.get_json()["ok"] is True
        assert json.loads(path.read_text())["style_notes"] == "Avoid yes/no answers."

    def test_get_returns_saved_style_notes(self, monkeypatch, tmp_path):
        path = tmp_path / "trivia_generation.json"
        path.write_text(json.dumps({"style_notes": "Be clever."}))
        monkeypatch.setattr(marquee_app, "TRIVIA_GENERATION_SETTINGS_PATH", path)
        client = _client()
        _admin(client)
        res = client.get("/admin/trivia/generation-settings")
        assert res.get_json()["style_notes"] == "Be clever."

    def test_requires_admin(self):
        client = _client()
        assert client.get("/admin/trivia/generation-settings").status_code == 302
        assert client.post("/admin/trivia/generation-settings", json={}).status_code == 401


class TestExemplarToggle:
    def test_sets_exemplar_true(self, monkeypatch):
        questions = [{"id": 1, "question": "Q", "answer": "A", "category": "FILM", "difficulty": 5}]
        saved = []
        monkeypatch.setattr(marquee_app, "get_trivia_questions", lambda: questions)
        monkeypatch.setattr(marquee_app, "save_trivia_questions", lambda qs: saved.extend(qs))
        client = _client()
        _admin(client)
        res = client.post("/admin/trivia/questions/1/exemplar")
        assert res.status_code == 200
        body = res.get_json()
        assert body["ok"] is True
        assert body["exemplar"] is True
        assert saved[0]["exemplar"] is True

    def test_toggles_exemplar_off(self, monkeypatch):
        questions = [{"id": 1, "question": "Q", "answer": "A", "category": "FILM", "difficulty": 5, "exemplar": True}]
        saved = []
        monkeypatch.setattr(marquee_app, "get_trivia_questions", lambda: questions)
        monkeypatch.setattr(marquee_app, "save_trivia_questions", lambda qs: saved.extend(qs))
        client = _client()
        _admin(client)
        res = client.post("/admin/trivia/questions/1/exemplar")
        assert res.status_code == 200
        assert res.get_json()["exemplar"] is False
        assert saved[0]["exemplar"] is False

    def test_returns_404_for_missing_question(self, monkeypatch):
        monkeypatch.setattr(marquee_app, "get_trivia_questions", lambda: [])
        monkeypatch.setattr(marquee_app, "save_trivia_questions", lambda qs: None)
        client = _client()
        _admin(client)
        res = client.post("/admin/trivia/questions/999/exemplar")
        assert res.status_code == 404

    def test_requires_admin(self):
        client = _client()
        assert client.post("/admin/trivia/questions/1/exemplar").status_code == 302


class TestGeneratePreview:
    def _base_questions(self):
        return [
            {"id": i, "question": f"Q{i}", "answer": f"A{i}", "category": "FILM", "difficulty": 5}
            for i in range(1, 16)
        ]

    def test_returns_empty_when_all_dates_filled(self, monkeypatch):
        from datetime import date, timedelta
        import unittest.mock as mock

        today = date(2026, 4, 10)
        all_dates = [(today + timedelta(days=i)).isoformat() for i in range(14)]
        monkeypatch.setattr(marquee_app, "get_all_trivia_puzzle_dates", lambda: all_dates)
        monkeypatch.setattr(marquee_app, "ANTHROPIC_API_KEY", "fake")
        monkeypatch.setattr(marquee_app, "get_trivia_questions", self._base_questions)
        monkeypatch.setattr(marquee_app, "get_trivia_generation_settings", lambda: {"style_notes": ""})

        with mock.patch("app.date") as mock_date:
            mock_date.today.return_value = today
            mock_date.fromisoformat = date.fromisoformat
            client = _client()
            _admin(client)
            res = client.post("/admin/trivia/generate")

        assert res.status_code == 200
        body = res.get_json()
        assert body["ok"] is True
        assert body["days"] == []

    def test_calls_claude_and_returns_days(self, monkeypatch):
        from datetime import date, timedelta
        import unittest.mock as mock

        today = date(2026, 4, 10)
        monkeypatch.setattr(marquee_app, "get_all_trivia_puzzle_dates", lambda: [])
        monkeypatch.setattr(marquee_app, "ANTHROPIC_API_KEY", "fake")
        monkeypatch.setattr(marquee_app, "get_trivia_questions", self._base_questions)
        monkeypatch.setattr(marquee_app, "get_trivia_generation_settings", lambda: {"style_notes": ""})

        fake_questions = [
            {"question": f"Generated Q{i}", "answer": f"GA{i}", "category": "SCIENCE", "difficulty": 5}
            for i in range(42)
        ]
        fake_response = json.dumps({"questions": fake_questions})
        monkeypatch.setattr(marquee_app, "_call_claude", lambda sys, usr, max_tokens=1024: (fake_response, None))

        with mock.patch("app.date") as mock_date:
            mock_date.today.return_value = today
            mock_date.fromisoformat = date.fromisoformat
            client = _client()
            _admin(client)
            res = client.post("/admin/trivia/generate")

        assert res.status_code == 200
        body = res.get_json()
        assert body["ok"] is True
        assert len(body["days"]) == 14
        assert len(body["days"][0]["questions"]) == 3
        assert body["days"][0]["date"] == "2026-04-10"

    def test_returns_503_when_anthropic_key_missing(self, monkeypatch):
        monkeypatch.setattr(marquee_app, "ANTHROPIC_API_KEY", "")
        client = _client()
        _admin(client)
        res = client.post("/admin/trivia/generate")
        assert res.status_code == 503

    def test_requires_admin(self):
        client = _client()
        assert client.post("/admin/trivia/generate").status_code == 302


class TestGenerateConfirm:
    def test_saves_questions_and_puzzle_files(self, monkeypatch, tmp_path):
        puzzles_dir = tmp_path / "trivia_puzzles"
        puzzles_dir.mkdir()
        existing = [{"id": 5, "question": "Old Q", "answer": "A", "category": "FILM", "difficulty": 5}]
        saved_qs = []
        monkeypatch.setattr(marquee_app, "get_trivia_questions", lambda: existing)
        monkeypatch.setattr(marquee_app, "save_trivia_questions", lambda qs: saved_qs.extend(qs))
        monkeypatch.setattr(marquee_app, "TRIVIA_PUZZLES_DIR", puzzles_dir)

        client = _client()
        _admin(client)
        res = client.post("/admin/trivia/generate/confirm", json={"days": [
            {"date": "2026-04-15", "questions": [
                {"question": "Q1", "answer": "A1", "category": "FILM", "difficulty": 4},
                {"question": "Q2", "answer": "A2", "category": "SPORTS", "difficulty": 6},
                {"question": "Q3", "answer": "A3", "category": "SCIENCE", "difficulty": 7},
            ]},
        ]})

        assert res.status_code == 200
        body = res.get_json()
        assert body["ok"] is True
        assert "2026-04-15" in body["saved_dates"]

        # 1 existing + 3 new = 4 total
        assert len(saved_qs) == 4
        assert saved_qs[1]["id"] == 6
        assert saved_qs[1]["question"] == "Q1"
        assert saved_qs[3]["id"] == 8

        puzzle = json.loads((puzzles_dir / "2026-04-15.json").read_text())
        assert puzzle["questions"] == [6, 7, 8]
        assert puzzle["date"] == "2026-04-15"

    def test_assigns_sequential_ids_across_multiple_days(self, monkeypatch, tmp_path):
        puzzles_dir = tmp_path / "trivia_puzzles"
        puzzles_dir.mkdir()
        existing = [{"id": 10, "question": "Old", "answer": "A", "category": "FILM", "difficulty": 5}]
        saved_qs = []
        monkeypatch.setattr(marquee_app, "get_trivia_questions", lambda: existing)
        monkeypatch.setattr(marquee_app, "save_trivia_questions", lambda qs: saved_qs.extend(qs))
        monkeypatch.setattr(marquee_app, "TRIVIA_PUZZLES_DIR", puzzles_dir)

        def make_day(date_str):
            return {"date": date_str, "questions": [
                {"question": f"Q{date_str}-{i}", "answer": "A", "category": "FILM", "difficulty": 5}
                for i in range(3)
            ]}

        client = _client()
        _admin(client)
        res = client.post("/admin/trivia/generate/confirm", json={
            "days": [make_day("2026-04-20"), make_day("2026-04-21")]
        })

        assert res.status_code == 200
        assert len(res.get_json()["saved_dates"]) == 2
        new_ids = [q["id"] for q in saved_qs if q["id"] != 10]
        assert new_ids == list(range(11, 17))

    def test_skips_days_with_wrong_question_count(self, monkeypatch, tmp_path):
        puzzles_dir = tmp_path / "trivia_puzzles"
        puzzles_dir.mkdir()
        saved_qs = []
        monkeypatch.setattr(marquee_app, "get_trivia_questions", lambda: [])
        monkeypatch.setattr(marquee_app, "save_trivia_questions", lambda qs: saved_qs.extend(qs))
        monkeypatch.setattr(marquee_app, "TRIVIA_PUZZLES_DIR", puzzles_dir)

        client = _client()
        _admin(client)
        res = client.post("/admin/trivia/generate/confirm", json={"days": [
            {"date": "2026-04-20", "questions": [
                {"question": "Q1", "answer": "A1", "category": "FILM", "difficulty": 4},
                {"question": "Q2", "answer": "A2", "category": "SPORTS", "difficulty": 6},
                # missing 3rd question
            ]},
        ]})

        assert res.status_code == 200
        assert res.get_json()["saved_dates"] == []
        assert not (puzzles_dir / "2026-04-20.json").exists()

    def test_requires_admin(self):
        client = _client()
        assert client.post("/admin/trivia/generate/confirm", json={}).status_code == 401

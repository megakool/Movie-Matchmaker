"""Unit tests for _stratified_sample recency bias."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import _stratified_sample


def _make_movies(year_list):
    return [{"id": i, "title": f"Film {i}", "year": y} for i, y in enumerate(year_list)]


def test_returns_exactly_n():
    movies = _make_movies([1980] * 10 + [2010] * 10)
    assert len(_stratified_sample(movies, 8)) == 8


def test_bias_zero_proportional():
    """With equal counts in two decades, bias=0 gives roughly equal split."""
    movies = _make_movies([1990] * 20 + [2010] * 20)
    counts = {1990: 0, 2010: 0}
    for _ in range(200):
        for m in _stratified_sample(movies, 10, recency_bias=0.0):
            counts[m["year"]] += 1
    # Each decade should get ~50% — allow ±20% tolerance over 2000 total picks
    assert 700 < counts[2010] < 1300, f"Expected ~1000, got {counts[2010]}"


def test_bias_one_gives_modern_majority():
    """With bias=1.0, post-2000 decades receive ≥55% of slots."""
    movies = _make_movies(
        [1970] * 10 + [1980] * 10 + [1990] * 10 + [2000] * 10 + [2010] * 10
    )
    modern_count = 0
    runs, n = 300, 10
    for _ in range(runs):
        modern_count += sum(1 for m in _stratified_sample(movies, n, recency_bias=1.0) if m["year"] >= 2000)
    assert modern_count / (runs * n) >= 0.55


def test_no_duplicates():
    movies = _make_movies([1990] * 5 + [2010] * 5)
    result = _stratified_sample(movies, 8)
    ids = [m["id"] for m in result]
    assert len(ids) == len(set(ids))


def test_empty_pool():
    assert _stratified_sample([], 5) == []


def test_n_larger_than_pool():
    movies = _make_movies([2000, 2010, 2015])
    assert len(_stratified_sample(movies, 10)) == 3

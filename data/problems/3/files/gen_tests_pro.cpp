#include "testlib.h"
#include <set>
#define sz(a) ((int) (a).size())
#define pb push_back
#define mp make_pair
#define fs first
#define sc second
using namespace std;

const int max_in_series = 1e7;
const int max_it = 10;
const int max_deg = 6;
const int P = 17239;
const double magic_c = 2.5;
const int primes[] = {8960453, 1000007, 997, 9129619, 17239, 9933463};
#define rndint rnd.next(1, (int) 1e7)
#define rndsmallint rnd.next(1, 100)
#define rndmod primes[rnd.next(0, (int) (sizeof(primes) / sizeof(primes[0]) - 1))]

class test {
private:
	string s;
	vector<string> dict;
	vector< pair<int, int> > queries;
	int series, alpha;
	
	void gen_series();
	char rnd_ch();
	string rnd_str(int len);
	int estimate_alpha(int dict_len);
	int estimate_shift(int dict_len);
	bool is_prefix(const string& a, const string& b);
	int correct_dictionary();
	
	void gen_random_dictionary(int dict_len);
	vector<int> gen_concatenate_string(int len);
	void gen_concatenate_queries(int len, int queries_cnt);
	
	void gen_shift_dictionary(int len);
	void gen_shift_string(int len);
	void gen_shift_queries(int queries_cnt);
	
	void gen_random_string(int len);
	void gen_random_queries(int queries_cnt);
	void gen_all_mini_dictionary(int depth);
	
	void gen_tree_test(int dict_len, int str_len, int q_cnt);
	
	void gen_noise_dictionary(int dict_len);
	
	void append(const test& other);
public:
	test(int alpha, int series);
	
	void output();
	void generate(int test_type, int dict_len, int str_len, int q_cnt);
};

void test::gen_series() {
	printf("%d\n", series);
	for (int i = 0, sum = 0; i < series; ++i) {
		int t = rnd.next(1, max_in_series - sum - (series - i - 1));
		if (i == series - 1) t = max_in_series - sum;
		printf("%d %d %d %d %d %d %d %d\n", t, rndsmallint, rndsmallint, rndsmallint, rndsmallint, rndmod, rndint, rndint);
		sum += t;
	}
}

void test::output() {
	printf("%d\n", sz(dict));
	shuffle(dict.begin(), dict.end());
	for (int i = 0; i < sz(dict); ++i)
		printf("%s\n", dict[i].c_str());
	printf("%s\n", s.c_str());
	printf("%d\n", sz(queries));
	shuffle(queries.begin(), queries.end());
	for (int i = 0; i < sz(queries); ++i)
		printf("%d %d\n", queries[i].fs + 1, queries[i].sc + 1);
	gen_series();
}

char test::rnd_ch() {
	return 'a' + rnd.next(0, alpha - 1);
}

string test::rnd_str(int len) {
	string res;
	for (int i = 0; i < len; ++i)
		res += rnd_ch();
	return res;
}

test::test(int alpha, int series): alpha(alpha), series(series) {
}

bool test::is_prefix(const string& a, const string& b) {
	if (sz(a) > sz(b)) return false;
	for (int i = 0; i < sz(a); ++i)
		if (a[i] != b[i]) return false;
		return true;
}

int test::correct_dictionary() {
	sort(dict.begin(), dict.end());
	vector<string> new_dict;
	int other = 0;
	for (int i = 0; i < sz(dict); ++i)
		if ((sz(new_dict) == 0) || !is_prefix(new_dict.back(), dict[i]))
			new_dict.pb(dict[i]);
		else
			other += sz(dict[i]);
		dict = new_dict;
	return other;
}

void test::gen_noise_dictionary(int dict_len) {
	int pow = 1, res = 0;
	while (pow * alpha * (res + 1) * magic_c <= dict_len) ++res, pow *= alpha;
	gen_all_mini_dictionary(res);
	dict.erase(dict.begin());
	for (int i = 0; i < sz(dict); ++i)
		for (int j = 0; j < dict_len / pow - res; ++j)
			dict[i] = "a" + dict[i];
}

vector<int> test::gen_concatenate_string(int len) {
	vector<int> begin;
	s = "";
	while (s.empty()) {
		while (true) {
			bool ok = false;
			for (int it = 0; it < max_it; ++it) {
				int i = rnd.next(0, sz(dict) - 1);
				if (sz(s) + sz(dict[i]) > len) continue;
				begin.pb(sz(s));
				s += dict[i];
				ok = true;
				break;
			}
			if (!ok) break;
		}
	}
	while (sz(s) < len) s += rnd_ch();
	return begin;
}

void test::gen_concatenate_queries(int len, int queries_cnt) {
	vector<int> begin = gen_concatenate_string(len);
	for (int i = 0; i < queries_cnt; ++i) {
		int l = rnd.next(0, sz(begin) - 2), r = rnd.next(l + 1, sz(begin) - 1);
		queries.pb(mp(begin[l], begin[r] - 1));
	}
}

void test::gen_shift_dictionary(int len) {
	string s = rnd_str(len);
	for (int i = 0; i < len; ++i) {
		dict.pb(s);
		s = s.substr(1) + s[0];
		if (alpha == 1) break;
	}
	correct_dictionary();
}

void test::gen_shift_string(int len) {
	gen_concatenate_string(len);
}

void test::gen_shift_queries(int queries_cnt) {
	int w = sz(dict[0]);
	for (int i = 0; i < queries_cnt; ++i) {
		int l = rnd.next(0, sz(s) - 1), k = rnd.next(0, (sz(s) - l) / w), r = l + k * w - 1;
		if (r < l) r = rnd.next(l, sz(s) - 1);
		queries.pb(mp(l, r));
	}
}

void test::gen_all_mini_dictionary(int depth) {
	dict.pb("");
	for (int i = 0; i < depth; ++i) {
		vector<string> tmp_dict = dict;
		dict.clear();
		for (int j = 0; j < sz(tmp_dict); ++j)
			for (char c = 'a'; c < 'a' + alpha; ++c)
				dict.pb(tmp_dict[j] + c);
	}
}

void test::gen_random_string(int len) {
	s = rnd_str(len);
}

void test::gen_random_queries(int queries_cnt) {
	for (int i = 0; i < queries_cnt; ++i) {
		int l = rnd.next(0, sz(s) - 1), r = rnd.next(l, sz(s) - 1);
		queries.pb(mp(l, r));
	}
}

int test::estimate_alpha(int dict_len) {
	int pow = 1, res = 0;
	while (pow * alpha * (res + 1) <= dict_len) pow *= alpha, ++res;
	return res;
}

int test::estimate_shift(int dict_len) {
	if (alpha == 1) return dict_len; else return sqrt(dict_len);
}

const int N = (int) 1e6 + 10;
const int L = 20;
int p[N][L], d[N], hres[N + 1], ppow[N + 1];
vector<int> adj[N];

void build_dictionary(vector<string> &dict, int v, int &len, string s) {
	if (sz(adj[v]) == 0) {
		if (len >= sz(s)) {
			len -= sz(s);
			dict.pb(s);
		}
		return;
	}
	for (int j = 0; j < sz(adj[v]); ++j)
		build_dictionary(dict, adj[v][j], len, s + (char) ('a' + j));
}

void test::gen_random_dictionary(int dict_len) {
	memset(d, 0, sizeof(d));
	for (int i = 0; i < dict_len; ++i)
		adj[i].clear();
	for (int i = 1, j; i < dict_len; ++i) {
		do {
			j = rnd.next(0, i - 1);
		} while (d[j] == alpha);
		++d[j], adj[j].pb(i);
	}
	build_dictionary(dict, 0, dict_len, "");
}

void test::append(const test& other) {
	s += other.s;
	for (int i = 0; i < sz(other.dict); ++i)
		dict.pb(other.dict[i]);
	for (int i = 0; i < sz(other.queries); ++i)
		queries.pb(other.queries[i]);
	series += other.series;
}

int go(int v, int h) {
	for (int i = L - 1; i >= 0; --i)
		if ((p[v][i] != -1) && (h >= (1 << i)))
			v = p[v][i], h -= (1 << i);
		return v;
}

void test::gen_tree_test(int dict_len, int str_len, int q_cnt) {
	memset(p, -1, sizeof(p));
	memset(d, 0, sizeof(d));
	vector<string> fragments;
	s = "";
	int cur_len = 0, bad_it = 0;
	cur_len += 2, fragments.pb(rnd_str(2)), dict.pb(fragments.back());
	while (true) {
		int deg = rnd.next(2, max_deg), cnt_done = 1;
		string cur = fragments.back();
		for (int i = 0; i < deg - 1; ++i) {
			string noise = rnd_str(2);
			bool found = false;
			for (int it = 0; it < max_it; ++it) {
				string nstr = fragments[rnd.next(0, sz(fragments) - 1)];
				if (sz(cur) + sz(noise) + sz(nstr) > str_len) continue;
				if (cur_len + sz(noise) + sz(cur) > dict_len) continue;
				cur_len += sz(noise) + sz(cur);
				found = true;
				dict.pb(noise + cur);
				cur = nstr + noise + cur;
				break;
			}
			if (!found) break;
			cnt_done++;
		}
		cur_len -= correct_dictionary();
		if (cnt_done == 1) {
			bad_it++;
			if (bad_it == max_it) break;
		} else {
			fragments.pb(cur);
			if (sz(cur) > sz(s)) s = cur;
		}
	}
	while (true) {
		bool found = false;
		for (int it = 0; it < max_it; ++it) {
			int i = rnd.next(0, sz(fragments) - 1);
			if (sz(s) + sz(fragments[i]) <= str_len) {
				s += fragments[i];
				found = true;
				break;
			}
		}
		if (!found) break;
	}
	while (sz(s) < str_len) s += rnd_ch();
	
	set<int> hashes, terminal;
	hashes.insert(0);
	for (int i = 0; i < sz(dict); ++i) {
		int h = 0;
		for (int j = 0; j < sz(dict[i]); ++j) {
			h = h * P + dict[i][j];
			hashes.insert(h);
		}
		terminal.insert(h);
	}
	hres[0] = 0, ppow[0] = 1;
	for (int i = 0; i < sz(s); ++i)
		hres[i + 1] = hres[i] * P + s[i], ppow[i + 1] = ppow[i] * P;
	for (int i = 0; i < sz(s); ++i) {
		int l = 0, r = sz(s) - i;
		while (l < r) {
			int q = (l + r + 1) / 2;
			if (hashes.count(hres[i + q] - hres[i] * ppow[q]))
				l = q;
			else
				r = q - 1;
		}
		if ((l > 0) && terminal.count(hres[i + l] - hres[i] * ppow[l])) p[i][0] = i + l;
	}
	d[sz(s)] = 0;
	for (int i = sz(s) - 1; i >= 0; --i)
		if (p[i][0] != -1) d[i] = d[p[i][0]] + 1; else d[i] = 0;
		for (int j = 1; j < L; ++j)
			for (int i = 0; i <= sz(s); ++i)
				if (p[i][j - 1] != -1) p[i][j] = p[p[i][j - 1]][j - 1];
				for (int i = 0; i < q_cnt; ++i) {
					int l = rnd.next(0, sz(s) - 1), h = rnd.next(0, d[l]), r = go(l, h);
					if (r <= l) r = rnd.next(l + 1, sz(s));
					queries.pb(mp(l, r - 1));
				}
}

void test::generate(int test_type, int dict_len, int str_len, int q_cnt) {
	fprintf(stderr, "generating with %d %d %d %d\n", test_type, dict_len, str_len, q_cnt);
	if (test_type == 0) {
		gen_random_dictionary(dict_len);
		gen_random_string(str_len);
		gen_random_queries(q_cnt);
	} else if (test_type == 1) {
		gen_shift_dictionary(estimate_shift(dict_len));
		gen_shift_string(str_len);
		gen_shift_queries(q_cnt);
	} else if (test_type == 3) {
		gen_all_mini_dictionary(estimate_alpha(dict_len));
		gen_random_string(str_len);
		gen_random_queries(q_cnt);
	} else if (test_type == 11) {
		gen_noise_dictionary(dict_len);
		alpha = 1;
		gen_random_string(str_len);
		gen_random_queries(q_cnt);
	} else if (test_type == 2) {
		gen_tree_test(dict_len, str_len, q_cnt);
	} else {
		for (int i = 0; i < test_type; ++i) {
			int q_used = sz(queries);
			int dict_used = 0;
			for (int j = 0; j < sz(dict); ++j)
				dict_used += sz(dict[j]);
			int str_used = sz(s);
			
			test tmp(alpha, 0);
			int type = rnd.next(0, 2);
			tmp.generate(type, (dict_len - dict_used) / (test_type - i), (str_len - str_used) / (test_type - i), (q_cnt - q_used) / (test_type - i));
			append(tmp);
			correct_dictionary();
		}
	}
}

int main(int argc, char ** argv) {
	registerGen(argc, argv, 1);
	int test_type = atoi(argv[1]);
	int dict_len = atoi(argv[2]);
	int str_len = atoi(argv[3]);
	int qs_cnt = atoi(argv[5]);
	int q_cnt = atoi(argv[4]);
	int alph = atoi(argv[6]);
	test t(alph, qs_cnt);
	t.generate(test_type, dict_len, str_len, q_cnt);
	t.output();
	return 0;
}
#include "testlib.h"
#define sz(a) ((int) (a).size())
#define pb push_back
#define mp make_pair
#define fs first
#define sc second
using namespace std;

const int max_in_series = 1e7;
const int max_int = 1e9;
const int max_it = 10;
const int primes[] = {179426549, 1000007, 997, 799273687, 17239};
#define rndint rnd.next(1, max_int)
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
	bool is_prefix(const string& a, const string& b);
	void correct_dictionary();
public:
	test(int alpha, int series);
	
	void output();
	
	void gen_random_dictionary();
	vector<int> gen_concatenate_string(int len);
	void gen_concatenate_queries(int len, int queries_cnt);
	
	void gen_shift_dictionary(int len);
	void gen_shift_string(int len);
	void gen_shift_queries(int queries_cnt);
	
	void gen_random_string();
	void gen_random_queries();
};

void test::gen_series() {
	printf("%d\n", series);
	for (int i = 0, sum = 0; i < series; ++i) {
		int t = rnd.next(1, max_in_series - sum - (series - i - 1));
		if (i == series - 1) t = max_in_series - sum;
		printf("%d %d %d %d %d %d %d %d\n", t, rndint, rndint, rndint, rndint, rndmod, rndint, rndint);
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

void test::correct_dictionary() {
	sort(dict.begin(), dict.end());
	vector<string> new_dict;
	for (int i = 0; i < sz(dict); ++i)
		if ((sz(new_dict) == 0) || !is_prefix(new_dict.back(), dict[i]))
			new_dict.pb(dict[i]);
	dict = new_dict;
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

int main(int argc, char ** argv) {
	registerGen(argc, argv, 1);
	int test_type = atoi(argv[1]);
	int dict_len = atoi(argv[2]);
	int str_len = atoi(argv[3]);
	int qs_cnt = atoi(argv[5]);
	int q_cnt = atoi(argv[4]);
	if (test_type == 1) {
		test t(1, qs_cnt);
		t.gen_shift_dictionary(dict_len);
		t.gen_shift_string(str_len);
		t.gen_shift_queries(q_cnt);
		t.output();
	}
	return 0;
}
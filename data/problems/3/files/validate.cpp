#include "testlib.h"
using namespace std;

const int N = 1e6;
const int M = 1e5;
const int S = 1e7;
const int INF = 1e7;
const int K = 1e5;

void check(const string& s) {
	for (int i = 0; i < (int) s.size(); ++i)
		ensure((s[i] >= 'a') || (s[i] <= 'z'));
}

bool prefix(const string& s, const string& t) {
	if (s.size() > t.size()) return false;
	for (int i = 0; i < (int) s.size(); ++i)
		if (s[i] != t[i]) return false;
	return true;
}

int main(int argc, char* argv[]) {
	registerValidation(argc, argv);
	int n = inf.readInt(1, N), sum = 0;
	inf.readEoln();
	vector<string> v;
	for (int i = 0; i < n; ++i) {
		string w = inf.readToken();
		v.push_back(w);
		sum += (int) w.size();
		inf.readEoln();
		check(w);
	}
	sort(v.begin(), v.end());
	for (int i = 1; i < n; ++i)
		ensure(!prefix(v[i - 1], v[i]));
	ensure(sum <= N);
	string s = inf.readToken();
	ensure((int) s.size() <= N);
	inf.readEoln();
	check(s);
	int m = inf.readInt(0, M);
	inf.readEoln();
	for (int i = 0; i < m; ++i) {
		int l = inf.readInt(1, (int) s.size());
		inf.readSpace();
		int r = inf.readInt(l, (int) s.size());
		inf.readEoln();
	}
	int k = inf.readInt(0, K);
	inf.readEoln();
	sum = 0;
	for (int i = 0; i < k; ++i) {
		int t = inf.readInt(1, S - sum);
		sum += t;
		inf.readSpace();
		int A = inf.readInt(1, 100);
		inf.readSpace();
		int B = inf.readInt(1, 100);
		inf.readSpace();
		int C = inf.readInt(1, 100);
		inf.readSpace();
		int D = inf.readInt(1, 100);
		inf.readSpace();
		int M = inf.readInt(1, INF);
		inf.readSpace();
		int l_1 = inf.readInt(1, INF);
		inf.readSpace();
		int r_1 = inf.readInt(1, INF);
		inf.readEoln();
	}
	inf.readEof();
	return 0;
}
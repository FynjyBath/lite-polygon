#include <bits/stdc++.h>
using namespace std;
int main(int argc, char* argv[]) {
    // argv[1]=input, argv[2]=output, argv[3]=answer
    ifstream outp(argv[2]), ans(argv[3]);
    string a, b;
    outp >> a; ans >> b;
    if (a == b) { cerr << "OK"; return 0; }
    cerr << "WRONG: expected " << b << " got " << a; return 1;
}
